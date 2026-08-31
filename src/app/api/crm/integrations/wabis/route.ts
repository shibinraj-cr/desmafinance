import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { prisma } from "@/lib/prisma";
import { parseTouchTemplates, TOUCH_PARAM_TOKENS } from "@/lib/crm-remarketing-templates";
import {
  getSetting,
  setSetting,
  WABIS_WEBHOOK_ENABLED_KEY,
  WABIS_WEBHOOK_SECRET_KEY,
  WABIS_REMARKETING_ENABLED_KEY,
  WABIS_REMARKETING_URLS_KEY,
  WABIS_REMARKETING_OFFSETS_KEY,
  WABIS_REMARKETING_KEYWORDS_KEY,
  WABIS_INBOUND_SECRET_KEY,
  REMARKETING_TRANSPORT_KEY,
  REMARKETING_TEMPLATES_KEY,
  REMARKETING_TEMPLATE_PARAMS_KEY,
} from "@/lib/app-settings";
import {
  resolveAgent,
  sendTestWebhook,
  requeueDelivery,
  drainWebhookQueue,
  isWabisWebhookUrl,
  LEAD_ASSIGNED_EVENT,
} from "@/lib/crm-webhook";
import {
  sendTestRemarketingTouch,
  runRemarketingScheduler,
  importWabisDeliveryReport,
  enrolRemainingRemarketing,
} from "@/lib/crm-remarketing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The delivery-report backfill replays rows one at a time; give it headroom
// beyond the default so a full report doesn't time out mid-import.
export const maxDuration = 60;

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
      // The routing table is about the lead-assignment intro; study-abroad
      // endpoints are configured in the same list but resolved separately.
      where: { isActive: true, purpose: LEAD_ASSIGNED_EVENT },
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

  const [
    enabled,
    secret,
    endpoints,
    deliveries,
    consultants,
    rmEnabled,
    rmUrls,
    rmOffsets,
    rmKeywords,
    rmInboundSecret,
    rmTransport,
    rmTemplates,
    rmTemplateParams,
  ] = await Promise.all([
    getSetting(WABIS_WEBHOOK_ENABLED_KEY),
    getSetting(WABIS_WEBHOOK_SECRET_KEY),
    prisma.wabisWebhookEndpoint.findMany({
      orderBy: [{ purpose: "asc" }, { isDefault: "desc" }, { isActive: "desc" }, { label: "asc" }],
      select: {
        id: true,
        purpose: true,
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
    getSetting(WABIS_REMARKETING_URLS_KEY),
    getSetting(WABIS_REMARKETING_OFFSETS_KEY),
    getSetting(WABIS_REMARKETING_KEYWORDS_KEY),
    getSetting(WABIS_INBOUND_SECRET_KEY),
    getSetting(REMARKETING_TRANSPORT_KEY),
    getSetting(REMARKETING_TEMPLATES_KEY),
    getSetting(REMARKETING_TEMPLATE_PARAMS_KEY),
  ]);

  return NextResponse.json({
    enabled: enabled === "1",
    // The secret is an outbound header we choose, and this route is admin-only,
    // so it is returned in full — the admin needs to paste it into Wabis.
    secret: secret ?? "",
    endpoints: endpoints.map((e) => ({
      id: e.id,
      purpose: e.purpose,
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
      // Raw stored strings — the admin edits the exact text. `urls` is exactly 4
      // entries (one per touch) so the UI can render 4 labelled fields; the engine
      // parses/validates them (see getRemarketingConfig / parseUrls).
      urls: [0, 1, 2, 3].map((i) => ((rmUrls ?? "").split("\n")[i] ?? "").trim()),
      offsets: rmOffsets ?? "5,19,33,45",
      keywords: rmKeywords ?? "",
      inboundSecret: rmInboundSecret ?? "",
      transport: (rmTransport ?? "").trim() === "cloud" ? "cloud" : "wabis",
      templates: [0, 1, 2, 3].map((i) => ((rmTemplates ?? "").split("\n")[i] ?? "").trim()),
      templateParams: [0, 1, 2, 3].map((i) => ((rmTemplateParams ?? "").split("\n")[i] ?? "").trim()),
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
    urls: z.array(z.string().trim().max(500)).max(8),
    offsets: z.string().trim().max(100),
    keywords: z.string().trim().max(500),
    inboundSecret: z.string().trim().max(200),
    transport: z.enum(["wabis", "cloud"]).optional(),
    templates: z.array(z.string().trim().max(200)).max(8).optional(),
    templateParams: z.array(z.string().trim().max(200)).max(8).optional(),
  }),
  z.object({
    action: z.literal("test_remarketing"),
    phone: z.string().trim().min(1).max(40),
    touch: z.number().int().min(1).max(4).optional(),
  }),
  z.object({ action: z.literal("run_remarketing_now") }),
  z.object({ action: z.literal("enrol_remaining_remarketing"), dryRun: z.boolean() }),
  z.object({
    action: z.literal("import_delivery_report"),
    // A pasted/uploaded Wabis workflow CSV export (≤ ~4 MB of text).
    csv: z.string().min(1).max(4_000_000),
    touch: z.number().int().min(1).max(4).optional(),
  }),
]);

/** Drop trailing blanks but keep interior ones — position IS the touch number. */
function trimTrailing(values: string[]): string[] {
  const out = [...values];
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

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

  // Run the re-marketing scheduler on demand — enqueue any due touch-point and
  // complete silent campaigns, then drain — the exact work the daily cron does,
  // but session-authed so an admin can fire it (and SEE the result) without the
  // CRON_SECRET. Idempotent: a touch already sent this cycle is stamped and not
  // re-sent. The scheduler result is returned verbatim so a `skipped` reason
  // (e.g. "remarketing disabled") is visible rather than a silent no-op — this
  // is the on-demand path that makes a stalled campaign diagnosable.
  if (body.action === "run_remarketing_now") {
    const scheduler = await runRemarketingScheduler();
    const drain = await drainWebhookQueue();
    return NextResponse.json({ ok: true, scheduler, drain });
  }

  // Bulk-enrol every un-touched Re-marketing lead into the drip (back-dates the
  // campaign so touch 1 is due). dryRun previews the count; commit opens campaigns
  // only — the scheduler ("Run now" / cron, rate-capped) does the actual sending.
  if (body.action === "enrol_remaining_remarketing") {
    const summary = await enrolRemainingRemarketing({ dryRun: body.dryRun });
    return NextResponse.json({ ok: true, summary });
  }

  // One-time backfill: replay a Wabis delivery-report CSV through the live
  // delivery-status handler so historical failures show in Campaign Delivery and
  // bad numbers get flagged — for the window before the delivery webhook was wired.
  if (body.action === "import_delivery_report") {
    const summary = await importWabisDeliveryReport({ csv: body.csv, touch: body.touch });
    return NextResponse.json({ ok: true, summary });
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
    const transport = body.transport ?? "wabis";
    const urls = body.urls.map((u) => u.trim());
    // Only enforced when Wabis is actually carrying the drip. After the cutover
    // the URLs are dead weight kept for a rollback, and refusing to save the page
    // because of a URL nothing reads would be an odd way to be strict.
    if (transport === "wabis") {
      const bad = urls.find((u) => u && !isWabisWebhookUrl(u));
      if (bad) {
        throw badRequest("Enter valid https Wabis workflow URLs (each must contain /webhook/).", "invalid_url");
      }
    }

    const templates = (body.templates ?? []).map((t) => t.trim());
    const templateParams = (body.templateParams ?? []).map((t) => t.trim());
    if (transport === "cloud") {
      // Validated with the ENGINE'S OWN parser rather than a regex of its own.
      // A hand-written check here disagreed with it about where to split, so the
      // page could accept a value the sender then read differently — and that
      // mistake looks fine and fails at Meta, per candidate.
      const malformed = templates.find((t) => t && parseTouchTemplates(t)[0] === null);
      if (malformed) {
        throw badRequest(
          `Templates must be written as name:language — "${malformed}" is missing one of them.`,
          "invalid_template",
        );
      }
      // A mistyped field name defers its touch every night, forever, and says so
      // only in a server log. Refused at the point somebody can still fix it.
      for (const line of templateParams) {
        const bad = line
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .find((t) => !(TOUCH_PARAM_TOKENS as readonly string[]).includes(t));
        if (bad) {
          throw badRequest(
            `"${bad}" is not a field a touch can use. Choose from: ${TOUCH_PARAM_TOKENS.join(", ")}.`,
            "invalid_token",
          );
        }
      }
    }
    // Drop trailing empties; store newline-positional (line i = touch i).
    while (urls.length && !urls[urls.length - 1]) urls.pop();
    await Promise.all([
      setSetting(WABIS_REMARKETING_ENABLED_KEY, body.enabled ? "1" : "0", userId),
      setSetting(WABIS_REMARKETING_URLS_KEY, urls.join("\n"), userId),
      setSetting(WABIS_REMARKETING_OFFSETS_KEY, body.offsets.trim(), userId),
      setSetting(WABIS_REMARKETING_KEYWORDS_KEY, body.keywords.trim(), userId),
      setSetting(WABIS_INBOUND_SECRET_KEY, body.inboundSecret.trim(), userId),
      setSetting(REMARKETING_TRANSPORT_KEY, transport, userId),
      setSetting(REMARKETING_TEMPLATES_KEY, trimTrailing(templates).join("\n"), userId),
      setSetting(
        REMARKETING_TEMPLATE_PARAMS_KEY,
        trimTrailing(templateParams).join("\n"),
        userId,
      ),
    ]);
    return NextResponse.json({ ok: true });
  }

  await Promise.all([
    setSetting(WABIS_WEBHOOK_ENABLED_KEY, body.enabled ? "1" : "0", userId),
    setSetting(WABIS_WEBHOOK_SECRET_KEY, body.secret.trim(), userId),
  ]);
  return NextResponse.json({ ok: true });
});
