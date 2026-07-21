import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { prisma } from "@/lib/prisma";
import {
  getSetting,
  setSetting,
  WABIS_WEBHOOK_ENABLED_KEY,
  WABIS_WEBHOOK_URL_KEY,
  WABIS_WEBHOOK_SECRET_KEY,
  WABIS_AGENT_OVERRIDES_KEY,
  WABIS_WEBHOOK_REFIRE_KEY,
} from "@/lib/app-settings";
import {
  parseAgentOverrides,
  resolveAgent,
  sendTestWebhook,
  requeueDelivery,
  type AgentOverride,
} from "@/lib/crm-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The consultants who can own a lead — the same active L1/L2 filter the assign
 * dropdown uses, so the settings table can't drift from who actually triggers
 * the webhook. Each row shows the name/phone that *would* be sent, already
 * resolved through any override, which is what makes a mismatch with Wabis
 * visible before a real lead hits it.
 */
async function consultantRows(overrides: Record<string, AgentOverride>) {
  const roles = await prisma.leadPulseRole.findMany({
    where: { active: true, role: { in: ["l1", "l2"] } },
    orderBy: { displayName: "asc" },
    select: { userId: true, displayName: true, phone: true },
  });
  return roles.map((r) => {
    const resolved = resolveAgent({
      userId: r.userId,
      displayName: r.displayName,
      phone: r.phone,
      overrides,
    });
    return {
      userId: r.userId,
      displayName: r.displayName,
      rolePhone: r.phone,
      overrideAgent: overrides[r.userId]?.agent ?? "",
      overridePhone: overrides[r.userId]?.phone ?? "",
      sendsAgent: resolved.agent,
      sendsAgentPhone: resolved.agentPhone,
    };
  });
}

// GET /api/crm/integrations/wabis — Wabis webhook config + delivery log (admin).
export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const [enabled, url, secret, refire, overridesRaw] = await Promise.all([
    getSetting(WABIS_WEBHOOK_ENABLED_KEY),
    getSetting(WABIS_WEBHOOK_URL_KEY),
    getSetting(WABIS_WEBHOOK_SECRET_KEY),
    getSetting(WABIS_WEBHOOK_REFIRE_KEY),
    getSetting(WABIS_AGENT_OVERRIDES_KEY),
  ]);
  const overrides = parseAgentOverrides(overridesRaw);

  const deliveries = await prisma.crmWebhookDelivery.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      event: true,
      leadId: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      responseStatus: true,
      responseBody: true,
      payload: true,
      createdAt: true,
      lastAttemptAt: true,
      deliveredAt: true,
    },
  });

  return NextResponse.json({
    enabled: enabled === "1",
    url: url ?? "",
    // The secret is optional and low-value (an outbound header we choose), so it
    // is returned in full — the admin needs to paste it into Wabis.
    secret: secret ?? "",
    refireOnReassign: refire === "1",
    consultants: await consultantRows(overrides),
    deliveries: deliveries.map((d) => ({
      ...d,
      candidateName:
        (d.payload && typeof d.payload === "object" && !Array.isArray(d.payload)
          ? ((d.payload as Record<string, unknown>).name as string | undefined)
          : undefined) ?? null,
      createdAt: d.createdAt.toISOString(),
      lastAttemptAt: d.lastAttemptAt?.toISOString() ?? null,
      deliveredAt: d.deliveredAt?.toISOString() ?? null,
    })),
  });
});

const OverrideSchema = z.object({
  agent: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
});

const PostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    enabled: z.boolean(),
    url: z.string().trim().max(500),
    secret: z.string().trim().max(200),
    refireOnReassign: z.boolean(),
    overrides: z.record(z.string(), OverrideSchema).default({}),
  }),
  z.object({ action: z.literal("test"), phone: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("requeue"), id: z.string().min(1) }),
]);

// POST /api/crm/integrations/wabis — save config, send a test, re-fire a delivery.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const body = PostSchema.parse(await req.json().catch(() => null));

  if (body.action === "test") {
    const result = await sendTestWebhook(body.phone);
    return NextResponse.json(result);
  }

  if (body.action === "requeue") {
    const result = await requeueDelivery(body.id);
    // A refusal is a real outcome the admin must see, not a silent success.
    if (!result.requeued) throw badRequest(result.reason ?? "This delivery can't be re-sent", "requeue_refused");
    return NextResponse.json(result);
  }

  // Turning the automation on without a destination would silently send
  // nothing, so it's rejected rather than stored as a misleading "on".
  const url = body.url.trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) {
    throw badRequest("Webhook URL must be an https:// address", "invalid_url");
  }
  if (body.enabled && !url) {
    throw badRequest("Add the Wabis webhook URL before enabling", "url_required");
  }

  // Store only real overrides — an empty row is the "use the consultant's own
  // name and number" default, and keeping blanks would grow the blob forever.
  const overrides: Record<string, AgentOverride> = {};
  for (const [key, value] of Object.entries(body.overrides)) {
    const agent = value.agent.trim();
    const phone = value.phone.trim();
    if (agent || phone) overrides[key] = { ...(agent && { agent }), ...(phone && { phone }) };
  }

  await Promise.all([
    setSetting(WABIS_WEBHOOK_ENABLED_KEY, body.enabled ? "1" : "0", userId),
    setSetting(WABIS_WEBHOOK_URL_KEY, url, userId),
    setSetting(WABIS_WEBHOOK_SECRET_KEY, body.secret.trim(), userId),
    setSetting(WABIS_WEBHOOK_REFIRE_KEY, body.refireOnReassign ? "1" : "0", userId),
    setSetting(WABIS_AGENT_OVERRIDES_KEY, JSON.stringify(overrides), userId),
  ]);

  return NextResponse.json({ ok: true });
});
