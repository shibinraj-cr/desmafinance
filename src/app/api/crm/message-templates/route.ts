import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { listMessageTemplates, serializeMessageTemplate } from "@/lib/crm-message-templates";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  return NextResponse.json({ templates: await listMessageTemplates() });
});

const CreateSchema = z.object({
  channel: z.enum(["email", "whatsapp"]),
  name: z.string().trim().min(1).max(120),
  // Single-line email subject (no CR/LF so it can't inject mail headers).
  subject: z.string().trim().max(300).regex(/^[^\r\n]*$/, "Subject can't contain line breaks").optional(),
  body: z.string().trim().min(1).max(20000),
  isActive: z.boolean().optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const d = CreateSchema.parse(await req.json().catch(() => null));

  const created = await prisma.crmMessageTemplate.create({
    data: {
      channel: d.channel,
      name: d.name,
      // WhatsApp has no subject; email keeps whatever was entered (may be blank).
      subject: d.channel === "whatsapp" ? null : d.subject?.trim() || null,
      body: d.body,
      isActive: d.isActive ?? true,
      createdById: userId,
    },
  });

  await recordAudit({
    entityType: "CrmMessageTemplate",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { channel: d.channel, name: d.name },
  });
  return NextResponse.json({ template: serializeMessageTemplate(created) }, { status: 201 });
});
