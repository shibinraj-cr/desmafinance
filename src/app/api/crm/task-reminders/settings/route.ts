import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { recordAudit } from "@/lib/audit";
import { listWaTemplates } from "@/lib/wa/templates";
import {
  setSetting,
  CRM_TASK_REMINDER_ENABLED_KEY,
  CRM_TASK_REMINDER_WA_TEMPLATE_KEY,
  CRM_TASK_REMINDER_WA_VARS_KEY,
  CRM_TASK_REMINDER_EMAIL_TEMPLATE_KEY,
  CRM_TASK_REMINDER_OVERRIDES_KEY,
  CRM_TASK_REMINDER_COOLDOWN_KEY,
  CRM_TASK_REMINDER_CHANNELS_KEY,
} from "@/lib/app-settings";
import {
  getTaskReminderConfig,
  TASK_REMINDER_CHANNELS,
  TASK_REMINDER_MERGE_FIELDS,
} from "@/lib/crm-task-reminders-engine";
import { TASK_TYPES } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The admin-managed defaults behind task auto-reminders.
 *
 * Gated on `canManageTemplates`, not `canManageSettings` — choosing the wording
 * a candidate receives IS a template decision, and it is the same capability
 * that already lets a marketing supervisor run the template catalogue without
 * being made a full CRM admin.
 */
export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const [config, wa, emailTemplates] = await Promise.all([
    getTaskReminderConfig(),
    listWaTemplates(),
    prisma.crmMessageTemplate.findMany({
      where: { channel: "email", isActive: true },
      select: { id: true, name: true, subject: true, body: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    config,
    // Every template is offered, whatever its cached status, with the status
    // reported alongside so the screen can warn instead of hiding. The cache is
    // only as fresh as the last sync — the status webhook field
    // (`message_template_status_update`) has to be selected on the WABA
    // subscription for approvals to arrive on their own — so filtering here
    // would hide a template Meta approved days ago.
    waTemplates: wa.templates.map((t) => ({
      key: `${t.name}:${t.language}`,
      name: t.name,
      language: t.language,
      status: t.status,
      category: t.category,
      body: t.spec?.body ?? t.metaBody ?? null,
    })),
    catalogueRead: wa.catalogueRead,
    emailTemplates,
    taskTypes: TASK_TYPES,
    mergeFields: TASK_REMINDER_MERGE_FIELDS,
  });
});

const OverrideSchema = z.object({
  waTemplate: z.string().trim().max(300).nullable().optional(),
  emailTemplateId: z.string().trim().max(60).nullable().optional(),
  waVariables: z.record(z.string(), z.string().max(200)).nullable().optional(),
});

const PutSchema = z.object({
  enabled: z.boolean(),
  waTemplate: z.string().trim().max(300).nullable(),
  waVariables: z.record(z.string(), z.string().max(200)),
  emailTemplateId: z.string().trim().max(60).nullable(),
  overrides: z.record(z.string(), OverrideSchema),
  // 0 disables the cooldown outright; the ceiling stops a typo from muting
  // reminders for a month.
  cooldownHours: z.number().int().min(0).max(168),
  defaultChannels: z.array(z.enum(TASK_REMINDER_CHANNELS)),
});

export const PUT = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const data = PutSchema.parse(await req.json().catch(() => null));

  await Promise.all([
    setSetting(CRM_TASK_REMINDER_ENABLED_KEY, data.enabled ? "1" : "0", userId),
    setSetting(CRM_TASK_REMINDER_WA_TEMPLATE_KEY, data.waTemplate ?? "", userId),
    setSetting(CRM_TASK_REMINDER_WA_VARS_KEY, JSON.stringify(data.waVariables), userId),
    setSetting(CRM_TASK_REMINDER_EMAIL_TEMPLATE_KEY, data.emailTemplateId ?? "", userId),
    setSetting(CRM_TASK_REMINDER_OVERRIDES_KEY, JSON.stringify(data.overrides), userId),
    setSetting(CRM_TASK_REMINDER_COOLDOWN_KEY, String(data.cooldownHours), userId),
    setSetting(CRM_TASK_REMINDER_CHANNELS_KEY, data.defaultChannels.join(","), userId),
  ]);

  // Worth an audit entry: this decides what every candidate receives when a
  // consultant misses a deadline, and it is changed from a screen several people
  // can reach.
  await recordAudit({
    entityType: "AppSetting",
    entityId: CRM_TASK_REMINDER_ENABLED_KEY,
    action: "UPDATE",
    userId,
    changes: {
      enabled: data.enabled,
      waTemplate: data.waTemplate,
      emailTemplateId: data.emailTemplateId,
      cooldownHours: data.cooldownHours,
      defaultChannels: data.defaultChannels,
      overrides: Object.keys(data.overrides),
    },
  });

  return NextResponse.json({ config: await getTaskReminderConfig() });
});
