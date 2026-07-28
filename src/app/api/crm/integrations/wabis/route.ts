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
  WABIS_WEBHOOK_SECRET_KEY,
  WABIS_REMARKETING_ENABLED_KEY,
  WABIS_REMARKETING_URL_KEY,
  WABIS_REMARKETING_OFFSETS_KEY,
  WABIS_REMARKETING_KEYWORDS_KEY,
  WABIS_INBOUND_SECRET_KEY,
} from "@/lib/app-settings";
import { resolveAgent, sendTestWebhook, requeueDelivery, drainWebhookQueue, isWabisWebhookUrl } from "@/lib/crm-webhook";
import { sendTestRemarketingTouch } from "@/lib/crm-remarketing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Global config, the endpoint list, and the delivery log for the settings page.
 * Per-endpoint CRUD lives in ./endpoints.
 */

/**
 * Every consultant who can own a lead — the same active L1/L2 filter the assign
 * dropdown uses, so the settings page can't drift from who actually triggers the
 * webhook. Each row carries the endpoint that would handle them and the exact
 * agent name/phone that would be sent, since a name that doesn't match Wabis is
 * the one failure this integration can't detect on its own.
 */
async function consultantRows() {
  const [roles, endpoints] = await Promise.all([
    prisma.leadPulseRole.findMany({
      where: { active: true, role: { in: ["l1", "l2"] } },
      orderBy: { displayName: "asc" },
      select: { userId: true, displayName: true, phone: true },
    }),
    prisma.wabisWebhookEndpoint.findMany({
      where: { isActive: true },
      select: { id: true, label: true, consultantId: true, isDefault: true, agentName: true, agentPhone: true },
    }),
  ]);

  const byConsultant = new Map(endpoints.filter((e) => e.consultantId).map((e) => [e.consultantId!, e]));
  const fallback = endpoints.find((e) => e.isDefault) ?? null;

  return roles.map((r) => {
    const own = byConsultant.get(r.userId) ?? null;
    const effective = own ?? fallback;
    const resolved = resolveAgent({ displayName: r.displayName, phone: r.phone, endpoint: effective });
    return {
      userId: r.userId,
      displayName: r.displayName,
      rolePhone: r.phone,
      endpointId: effective?.id ?? null,
      endpointLabel: effective?.label ?? null,
      /** True when they're riding the fallback rather than their own workflow. */
      usingDefault: !own && !!fallback,
      /** Nothing will send for this consultant at all. */
      unrouted: !effective,
      sendsAgent: resolved.agent,
      sendsAgentPhone: resolved.agentPhone,
    };
  });
}

// GET /api/crm/integrations/wabis — config, endpoints, consultants, delivery log.
export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const [enabled, secret, endpoints, deliveries, consultants, rmEnabled, rmUrl, rmOffsets, rmKeywords, rmInboundSecret] =
    await Promise.all([
    getSetting(WABIS_WEBHOOK_ENABLED_KEY),
    getSetting(WABIS_WEBHOOK_SECRET_KEY),
    prisma.wabisWebhookEndpoint.findMany({
      orderBy: [{ isDefault: "desc" }, { isActive: "desc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        consultantId: true,
        webhookUrl: true,
        agentName: true,
        agentPhone: true,
        isActive: true,
        isDefault: true,
        consultant: { select: { leadPulseRole: { select: { displayName: true } }, username: true } },
      },
    }),
    prisma.crmWebhookDelivery.findMany({
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
        endpointLabel: true,
        payload: true,
        createdAt: true,
        lastAttemptAt: true,
        deliveredAt: true,
      },
    }),
    consultantRows(),
    getSetting(WABIS_REMARKETING_ENABLED_KEY),
    getSetting(WABIS_REMARKETING_URL_KEY),
    getSetting(WABIS_REMARKETING_OFFSETS_KEY),
    getSetting(WABIS_REMARKETING_KEYWORDS_KEY),
    getSetting(WABIS_INBOUND_SECRET_KEY),
  ]);

  return NextResponse.json({
    enabled: enabled === "1",
    // The secret is an outbound header we choose, and this route is admin-only,
    // so it is returned in full — the admin needs to paste it into Wabis.
    secret: secret ?? "",
    endpoints: endpoints.map((e) => ({
      id: e.id,
      label: e.label,
      consultantId: e.consultantId,
      consultantName: e.consultant?.leadPulseRole?.displayName ?? e.consultant?.username ?? null,
      webhookUrl: e.webhookUrl,
      agentName: e.agentName ?? "",
      agentPhone: e.agentPhone ?? "",
      isActive: e.isActive,
      isDefault: e.isDefault,
    })),
    consultants,
    remarketing: {
      enabled: rmEnabled === "1",
      // Raw stored strings — the admin edits the exact text (URL, "5,19,33",
      // keyword list). The engine parses/validates them (see getRemarketingConfig).
      url: rmUrl ?? "",
      offsets: rmOffsets ?? "5,19,33",
      keywords: rmKeywords ?? "",
      inboundSecret: rmInboundSecret ?? "",
    },
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

const PostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    enabled: z.boolean(),
    secret: z.string().trim().max(200),
  }),
  z.object({
    action: z.literal("test"),
    endpointId: z.string().min(1),
    phone: z.string().trim().min(1).max(40),
  }),
  z.object({ action: z.literal("requeue"), id: z.string().min(1) }),
  z.object({ action: z.literal("drain") }),
  z.object({
    action: z.literal("save_remarketing"),
    enabled: z.boolean(),
    url: z.string().trim().max(500),
    offsets: z.string().trim().max(100),
    keywords: z.string().trim().max(500),
    inboundSecret: z.string().trim().max(200),
  }),
  z.object({
    action: z.literal("test_remarketing"),
    phone: z.string().trim().min(1).max(40),
    touch: z.number().int().min(1).max(3).optional(),
  }),
]);

// POST /api/crm/integrations/wabis — save global config, send a test, re-fire, drain.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const body = PostSchema.parse(await req.json().catch(() => null));

  if (body.action === "test") {
    return NextResponse.json(await sendTestWebhook({ endpointId: body.endpointId, phone: body.phone }));
  }

  // Fire a sample re-marketing touch at the configured workflow URL — proves the
  // pipeline end-to-end AND lets Wabis capture the payload shape for field mapping.
  if (body.action === "test_remarketing") {
    return NextResponse.json(await sendTestRemarketingTouch({ phone: body.phone, touch: body.touch }));
  }

  // On the Hobby plan the retry cron may only run once a day, so an admin needs
  // a way to flush the queue immediately after fixing whatever was wrong.
  if (body.action === "drain") {
    return NextResponse.json(await drainWebhookQueue());
  }

  if (body.action === "requeue") {
    const result = await requeueDelivery(body.id);
    // A refusal is a real outcome the admin must see, not a silent success.
    if (!result.requeued) {
      return NextResponse.json({ error: "requeue_refused", message: result.reason }, { status: 400 });
    }
    return NextResponse.json(result);
  }

  if (body.action === "save_remarketing") {
    const url = body.url.trim();
    if (url && !isWabisWebhookUrl(url)) {
      throw badRequest("Enter a valid https Wabis workflow URL (must contain /webhook/).", "invalid_url");
    }
    await Promise.all([
      setSetting(WABIS_REMARKETING_ENABLED_KEY, body.enabled ? "1" : "0", userId),
      setSetting(WABIS_REMARKETING_URL_KEY, url, userId),
      setSetting(WABIS_REMARKETING_OFFSETS_KEY, body.offsets.trim(), userId),
      setSetting(WABIS_REMARKETING_KEYWORDS_KEY, body.keywords.trim(), userId),
      setSetting(WABIS_INBOUND_SECRET_KEY, body.inboundSecret.trim(), userId),
    ]);
    return NextResponse.json({ ok: true });
  }

  await Promise.all([
    setSetting(WABIS_WEBHOOK_ENABLED_KEY, body.enabled ? "1" : "0", userId),
    setSetting(WABIS_WEBHOOK_SECRET_KEY, body.secret.trim(), userId),
  ]);
  return NextResponse.json({ ok: true });
});
