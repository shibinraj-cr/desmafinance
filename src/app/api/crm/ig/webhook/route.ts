import { NextResponse } from "next/server";
import {
  getSetting,
  setSetting,
  IG_LAST_WEBHOOK_AT_KEY,
  IG_VERIFY_TOKEN_KEY,
  WA_CLOUD_APP_SECRET_KEY,
} from "@/lib/app-settings";
import { verifyMetaSignature, WA_SIGNATURE_HEADER } from "@/lib/wa/signature";
import { extractIgEvents } from "@/lib/ig/webhook";
import { getIgConfig } from "@/lib/ig/graph";
import { ingestIgEvents } from "@/lib/ig/ingest";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Instagram messaging webhook (object "instagram") — the only entrance for DMs.
 *
 * Separate from the WhatsApp hook because Meta configures a callback URL per
 * webhook OBJECT, and keeping them apart means a change to one cannot disturb
 * the other's live traffic.
 *
 * Auth is Meta's `X-Hub-Signature-256` and nothing else. Unlike the WhatsApp
 * hook there is no relay in front of this one, so there is no case for the
 * weaker shared-secret fallback: an unsigned or mis-signed POST is refused, and
 * with no app secret stored the hook is closed (503) rather than open.
 *
 * Answers 200 for anything it understood, including a batch with nothing in it
 * — Meta disables a subscription that keeps failing, which would lose far more
 * than one unreadable payload. The exception is a message that could not be
 * STORED: that gets a 502 so Meta redelivers, and the redelivery is safe
 * because messages collide on their Meta id.
 */
export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  const appSecret =
    (await getSetting(WA_CLOUD_APP_SECRET_KEY).catch(() => null))?.trim() || process.env.WA_CLOUD_APP_SECRET || null;
  if (!appSecret) {
    return NextResponse.json({ error: "app secret not set — hook disabled" }, { status: 503 });
  }

  // Verified on the raw bytes, before parsing — see verifyMetaSignature.
  if (verifyMetaSignature(rawBody, req.headers.get(WA_SIGNATURE_HEADER), appSecret) !== "valid") {
    logger.warn("ig_webhook_bad_signature", {});
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // The heartbeat behind "last delivery" on the settings page: proof Meta is
  // sending at all, before the first lead ever appears.
  await setSetting(IG_LAST_WEBHOOK_AT_KEY, new Date().toISOString()).catch(() => undefined);

  let body: unknown = null;
  try {
    body = rawBody.trim() ? (JSON.parse(rawBody) as unknown) : null;
  } catch {
    body = null;
  }

  const events = extractIgEvents(body);
  if (events.length === 0) {
    // Reads, reactions and other non-message events land here. Logged by shape
    // only — payloads carry what candidates wrote.
    logger.info("ig_webhook_no_messages", {
      object: body && typeof body === "object" ? String((body as { object?: unknown }).object ?? "") : null,
    });
    return NextResponse.json({ ok: true, received: 0 });
  }

  const summary = await ingestIgEvents(events, await getIgConfig());
  if (summary.failed > 0) return NextResponse.json({ ok: false, ...summary }, { status: 502 });
  return NextResponse.json({ ok: true, ...summary });
}

/**
 * Meta's verification handshake: `hub.mode=subscribe`, `hub.verify_token`,
 * `hub.challenge`. The challenge is echoed as bare text, or Meta refuses the
 * callback URL.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token")?.trim() ?? "";
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !challenge) {
    return NextResponse.json({ error: "not a verification request" }, { status: 400 });
  }
  const expected = (await getSetting(IG_VERIFY_TOKEN_KEY).catch(() => null))?.trim();
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}
