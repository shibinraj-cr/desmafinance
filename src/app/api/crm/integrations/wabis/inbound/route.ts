import { NextResponse } from "next/server";
import { getSetting, WABIS_INBOUND_SECRET_KEY } from "@/lib/app-settings";
import { handleRemarketingReply } from "@/lib/crm-remarketing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Inbound Wabis reply hook — the return leg of the re-marketing loop.
 *
 * A Wabis Flow-Builder keyword-reply bot (e.g. one triggered on "Interested")
 * drops an "HTTP API" block that POSTs here when a candidate replies to a
 * re-marketing touch. If the lead is in Re-marketing and the reply clears the
 * configured keyword gate, it auto-advances to Follow-Up (see handleRemarketingReply).
 *
 * Auth: a shared secret set in CRM → Settings, sent by Wabis either as the
 * `x-wabis-secret` header or a `?key=` query param. Fail-closed when unset, so the
 * endpoint can never be driven anonymously.
 *
 * Body/params are read leniently because Wabis field names vary by flow config:
 *   lead_id (echoed from our outbound payload — the reliable key), phone, and the
 *   reply text under any of message/text/keyword/reply/body.
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

  const result = await handleRemarketingReply({
    leadId: pick("lead_id", "leadId"),
    phone: pick("phone", "mobile", "subscriber", "from", "wa_id"),
    text: pick("message", "text", "keyword", "reply", "body"),
  });

  const status = result.ok ? 200 : result.reason === "lead_not_found" ? 404 : 400;
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
