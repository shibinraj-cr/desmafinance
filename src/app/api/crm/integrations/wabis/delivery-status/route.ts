import { NextResponse } from "next/server";
import { getSetting, WABIS_INBOUND_SECRET_KEY } from "@/lib/app-settings";
import { handleWabisDeliveryStatus } from "@/lib/crm-remarketing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Inbound Wabis DELIVERY-STATUS hook — the async truth about a re-marketing touch.
 *
 * Our outbound POST to a Wabis workflow returns 200 the moment Wabis ACCEPTS the
 * message; whether Meta actually delivered it (or bounced it with 131026 / capped
 * it with 131049) lands seconds-to-minutes later and is invisible to that response.
 * A Wabis delivery-status flow (an "HTTP API" block on the workflow's
 * delivered/read/failed events) POSTs that outcome here so DesGro can (a) stop
 * re-hammering a dead number on later touches and (b) show BDEs/admins which leads
 * the campaign failed to reach (see handleWabisDeliveryStatus + /crm/deliveries).
 *
 * Auth mirrors the reply hook: the same `wabis_inbound_secret` from CRM → Settings,
 * sent as the `x-wabis-secret` header or a `?key=` query param. Fail-closed when
 * unset so it can never be driven anonymously.
 *
 * Body/params are read leniently because Wabis field names vary by flow config:
 *   campaign_id + touch (echoed from our outbound payload — the exact key),
 *   lead_id (also echoed), phone, the delivery status, and any Meta error code.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = (await getSetting(WABIS_INBOUND_SECRET_KEY).catch(() => null))?.trim() || null;
  if (!secret) {
    return NextResponse.json({ error: "inbound secret not set — hook disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided = req.headers.get("x-wabis-secret")?.trim() || url.searchParams.get("key")?.trim() || "";
  if (provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const q = url.searchParams;
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const fromBody = body?.[k];
      if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();
      if (typeof fromBody === "number") return String(fromBody);
      const fromQuery = q.get(k);
      if (fromQuery && fromQuery.trim()) return fromQuery.trim();
    }
    return null;
  };

  const touchRaw = pick("touch", "touch_index", "touchIndex");
  const touch = touchRaw && /^\d+$/.test(touchRaw) ? Number(touchRaw) : null;

  const result = await handleWabisDeliveryStatus({
    leadId: pick("lead_id", "leadId"),
    campaignId: pick("campaign_id", "campaignId"),
    touch,
    phone: pick("phone", "mobile", "subscriber", "to", "wa_id"),
    status: pick("status", "message_status", "delivery_status", "event", "state"),
    errorCode: pick("error_code", "errorCode", "code", "error"),
    errorMessage: pick("error_message", "errorMessage", "reason", "description", "message"),
  });

  const status = result.ok ? 200 : result.reason === "unrecognized_status" ? 400 : 400;
  return NextResponse.json(result, { status });
}

export async function POST(req: Request) {
  return handle(req);
}

// GET accepted too: some Wabis HTTP-API blocks are easier to configure as GET with
// query params. Same secret gate either way.
export async function GET(req: Request) {
  return handle(req);
}
