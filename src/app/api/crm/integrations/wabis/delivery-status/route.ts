import { NextResponse } from "next/server";
import { getSetting, WABIS_INBOUND_SECRET_KEY } from "@/lib/app-settings";
import {
  handleWabisDeliveryStatus,
  extractDeliveryEvents,
  normalizeDeliveryStatus,
  type RawDeliveryEvent,
} from "@/lib/crm-remarketing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Inbound Wabis DELIVERY-STATUS hook — the async truth about a re-marketing touch.
 *
 * Our outbound POST to a Wabis workflow returns 200 the moment Wabis ACCEPTS the
 * message; whether Meta actually delivered it (or bounced it with 131026 / capped
 * it with 131049) lands seconds-to-minutes later and is invisible to that response.
 *
 * This handles TWO wiring styles:
 *   - Wabis's GLOBAL "Message Status Change" webhook (Bot Settings) — the simplest
 *     setup — which forwards WhatsApp/Meta's NATIVE envelope, often BATCHED
 *     (entry[].changes[].value.statuses[]), for every message the bot sends.
 *   - A per-workflow "HTTP API" block sending our own flat {phone,status,...} shape.
 * extractDeliveryEvents() copes with both (+ a plain test curl), so we iterate.
 *
 * `sent` acks are ignored (highest volume, no signal); delivered/read/failed are
 * processed. A hard failure stops the lead's remaining touches; 131026 flags the
 * number (see handleWabisDeliveryStatus + /crm/deliveries).
 *
 * Auth: the same `wabis_inbound_secret` from CRM → Settings, as the `x-wabis-secret`
 * header OR a `?key=` query param (the global webhook UI only offers a URL field, so
 * the query param is the supported route there). Fail-closed when unset.
 *
 * Always answers 200 once authenticated — even when nothing matched — so a status
 * sender never treats the endpoint as failing and disables it.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = (await getSetting(WABIS_INBOUND_SECRET_KEY).catch(() => null))?.trim() || null;
  if (!secret) {
    return NextResponse.json({ error: "inbound secret not set — hook disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided = req.headers.get("x-wabis-secret")?.trim() || url.searchParams.get("key")?.trim() || "";
  if (provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as unknown;
  let events = extractDeliveryEvents(body);

  // GET / URL-encoded style (a test or a simple flow): synthesise one event from
  // the query string when the body carried none.
  if (events.length === 0) {
    const q = url.searchParams;
    const qs = (...keys: string[]) => {
      for (const k of keys) {
        const v = q.get(k);
        if (v && v.trim()) return v.trim();
      }
      return null;
    };
    const phone = qs("phone", "mobile", "wa_id", "to", "recipient_id");
    const touchRaw = qs("touch", "touch_index");
    if (phone || qs("lead_id", "leadId")) {
      events = [
        {
          phone,
          status: qs("status", "message_status", "delivery_status", "state", "event"),
          errorCode: qs("error_code", "errorCode", "code"),
          errorMessage: qs("error_message", "errorMessage", "reason", "description"),
          campaignId: qs("campaign_id", "campaignId"),
          touch: touchRaw && /^\d+$/.test(touchRaw) ? Number(touchRaw) : null,
          leadId: qs("lead_id", "leadId"),
        } satisfies RawDeliveryEvent,
      ];
    }
  }

  if (events.length === 0) {
    // Nothing parseable — surface the shape in the logs so the payload can be
    // matched later, but still ACK so Wabis keeps the webhook enabled.
    console.warn(
      "[wabis delivery-status] no events parsed; top-level keys:",
      body && typeof body === "object" ? Object.keys(body as object).join(",") : typeof body,
    );
    return NextResponse.json({ ok: true, received: 0, processed: 0 });
  }

  let processed = 0;
  let failed = 0;
  let matched = 0;
  for (const ev of events) {
    const norm = normalizeDeliveryStatus(ev.status, ev.errorCode, ev.errorMessage);
    // Skip `sent` acks and anything unrecognisable — no lead action, and they are
    // the bulk of a global feed.
    if (!norm || norm === "sent") continue;
    const res = await handleWabisDeliveryStatus({
      leadId: ev.leadId,
      campaignId: ev.campaignId,
      touch: ev.touch,
      phone: ev.phone,
      status: ev.status,
      errorCode: ev.errorCode,
      errorMessage: ev.errorMessage,
    });
    processed++;
    if (norm === "failed") failed++;
    if (res.ok && res.leadId) matched++;
  }

  return NextResponse.json({ ok: true, received: events.length, processed, failed, matched });
}

export async function POST(req: Request) {
  return handle(req);
}

// GET accepted too: some Wabis HTTP-API blocks are easier to configure as GET with
// query params. Same secret gate either way.
export async function GET(req: Request) {
  return handle(req);
}
