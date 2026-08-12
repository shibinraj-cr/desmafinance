import { NextResponse } from "next/server";
import {
  getSetting,
  WABIS_INBOUND_SECRET_KEY,
  WABIS_CAPTURE_ENABLED_KEY,
  WABIS_CAPTURE_KEYWORD_KEY,
  WABIS_CAPTURE_CAMPAIGN_KEY,
} from "@/lib/app-settings";
import { captureWabisLead, resolveConsultantHint } from "@/lib/crm-wabis-capture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Inbound WhatsApp lead-capture hook.
 *
 * A Wabis keyword-reply flow (keyword e.g. "study abroad", CONTAINS / String
 * match) whose "Forward Data to Webhook" points here POSTs the candidate's
 * subscriber profile when they first message the marketing number. We create a
 * CRM lead — deduped so repeat texters fold to a re-inquiry. See
 * src/lib/crm-wabis-capture.ts.
 *
 * Wabis's fixed payload (captured live): { first_name, chat_id, user_message,
 * whatsapp_bot_username, postbackid, user_input_data }. chat_id is bare
 * international digits (no '+'); normalizePhone digests it. That field set carries
 * NO assigned agent, so exact-owner routing rides an OPTIONAL ?agent= hint that
 * per-agent Wabis flows can add later — absent, the lead lands unassigned.
 *
 * Auth: the shared WABIS_INBOUND_SECRET_KEY, sent as header `x-wabis-secret` or
 * `?key=` (this Wabis field can't add custom headers, so the query form is what
 * we expect). Fail-closed when the secret is unset or capture is disabled.
 */
async function handle(req: Request): Promise<NextResponse> {
  const [enabled, secret, keyword, campaignSetting] = await Promise.all([
    getSetting(WABIS_CAPTURE_ENABLED_KEY).catch(() => null),
    getSetting(WABIS_INBOUND_SECRET_KEY).catch(() => null),
    getSetting(WABIS_CAPTURE_KEYWORD_KEY).catch(() => null),
    getSetting(WABIS_CAPTURE_CAMPAIGN_KEY).catch(() => null),
  ]);

  if (enabled !== "1") return NextResponse.json({ error: "lead capture disabled" }, { status: 503 });
  const expected = secret?.trim() || null;
  if (!expected) return NextResponse.json({ error: "inbound secret not set — hook disabled" }, { status: 503 });

  const url = new URL(req.url);
  const provided = req.headers.get("x-wabis-secret")?.trim() || url.searchParams.get("key")?.trim() || "";
  if (provided !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const q = url.searchParams;
  // Wabis field names vary by flow config, so read leniently from body then query.
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

  const message = pick("user_message", "message", "text", "body", "keyword");

  // Server-side safety net: even though Wabis gates on the keyword, re-check here
  // so a mis-wired flow can't pour unrelated chatter into the CRM. A blank keyword
  // setting trusts Wabis. A non-match is a no-op success (200), not an error — so
  // Wabis doesn't treat it as a failed delivery and retry.
  const gate = keyword?.trim() || "";
  if (gate && message && !message.toLowerCase().includes(gate.toLowerCase())) {
    return NextResponse.json({ ok: true, skipped: "keyword_not_matched" });
  }

  const campaign = campaignSetting?.trim() || "Study Abroad";
  const assignToUserId = await resolveConsultantHint(pick("agent", "consultant", "owner"));

  const result = await captureWabisLead({
    name: pick("first_name", "name", "full_name", "candidate_name"),
    phone: pick("chat_id", "phone", "mobile", "wa_id", "subscriber", "from"),
    email: pick("email", "email_address"),
    message,
    botNumber: pick("whatsapp_bot_username", "bot_number"),
    campaign,
    assignToUserId,
  });

  // Every outcome (created / reinquiry / skipped) is a normal 200 result the
  // caller logs — a skip is information, not a delivery failure Wabis should retry.
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return handle(req);
}

// GET accepted too: some Wabis HTTP-API blocks are easier to configure as GET
// with query params. Same secret + keyword gate either way.
export async function GET(req: Request) {
  return handle(req);
}
