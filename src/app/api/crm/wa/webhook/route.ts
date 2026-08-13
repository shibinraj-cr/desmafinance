import { NextResponse } from "next/server";
import { getSetting, WA_CLOUD_APP_SECRET_KEY, WA_MIRROR_SECRET_KEY } from "@/lib/app-settings";
import { extractInboundMessages } from "@/lib/wa/inbound";
import { getWaMirrorConfig, ingestInboundMessages } from "@/lib/wa/mirror";
import { verifyMetaSignature, WA_SIGNATURE_HEADER } from "@/lib/wa/signature";
import { logger } from "@/lib/logger";

/** A body we cannot parse is not an error here — see the always-200 note below. */
function parseJson(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Inbound WhatsApp MESSAGE hook — the conversation mirror's only entrance.
 *
 * Distinct from the two hooks that already exist, and deliberately not merged
 * with them: `/integrations/wabis/inbound` advances a re-marketing lead on a
 * keyword-matched reply, and `/integrations/wabis/delivery-status` records what
 * Meta did with a message we sent. This one stores what was actually SAID, which
 * neither of those has ever captured. Keeping it separate means deploying the
 * mirror cannot disturb a live automation.
 *
 * Accepts Meta's native batched envelope (`entry[].changes[].value.messages[]`)
 * as well as the flat shapes a relay sends — see extractInboundMessages. The
 * same parser therefore serves both a Wabis relay today and the Cloud API after
 * cutover; only the auth below changes.
 *
 * Auth: a shared secret from CRM → Settings, as the `x-wa-secret` header or a
 * `?key=` query param (a webhook UI that only offers a URL field has no way to
 * send a header). Fail-closed when unset, so the endpoint can never be driven
 * anonymously. Its own secret rather than the re-marketing one, so rotating
 * either cannot silently break the other.
 *
 * Answers 200 for anything we understood, INCLUDING a batch we could not parse:
 * a sender that sees a non-2xx retries and, on repeated failure, disables the
 * subscription outright — losing far more than the one payload we could not read.
 *
 * The single exception is a message that parsed but could not be STORED (a
 * database blip). That gets a 502, because the whole point of the mirror is
 * never to lose a message and redelivery is the only thing that can save it.
 * A redelivery is safe: it collides on `providerMessageId` rather than
 * duplicating.
 */
async function handle(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);

  // Read the body ONCE, as raw text. Meta's signature covers the exact bytes, so
  // parsing and re-serialising to verify would produce a different digest and
  // fail every request.
  const rawBody = req.method === "GET" ? "" : await req.text().catch(() => "");

  const [sharedSecretRaw, appSecretRaw] = await Promise.all([
    getSetting(WA_MIRROR_SECRET_KEY).catch(() => null),
    getSetting(WA_CLOUD_APP_SECRET_KEY).catch(() => null),
  ]);
  const sharedSecret = sharedSecretRaw;
  // Env fallback, like every other Cloud credential. Without it a deployment
  // that sets the app secret only in the environment would silently never
  // verify a signature — the check would report `not_configured` forever.
  const appSecret = appSecretRaw?.trim() || process.env.WA_CLOUD_APP_SECRET || null;

  // Meta's HMAC when we hold an app secret and the sender signed; the shared
  // secret otherwise. Strictly a widening — a signed request is accepted on its
  // signature alone, an unsigned one still has to present the shared secret, and
  // with neither configured the endpoint stays closed.
  const verdict = verifyMetaSignature(rawBody, req.headers.get(WA_SIGNATURE_HEADER), appSecret);
  if (verdict === "invalid") {
    logger.warn("wa_webhook_bad_signature", {});
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (verdict !== "valid") {
    const secret = sharedSecret?.trim() || null;
    if (!secret) {
      return NextResponse.json({ error: "mirror secret not set — hook disabled" }, { status: 503 });
    }
    const provided = req.headers.get("x-wa-secret")?.trim() || url.searchParams.get("key")?.trim() || "";
    if (provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const config = await getWaMirrorConfig();
  if (!config.enabled) return NextResponse.json({ ok: true, skipped: "mirror_disabled" });

  // Body first, query string second. A GET-with-query-params relay is a shape
  // this team already configures — both pre-existing Wabis hooks read fields
  // from the body OR the query for exactly that reason — and a bare test curl
  // is the fastest way to prove the endpoint is wired at all.
  const body = parseJson(rawBody);
  let messages = extractInboundMessages(body);
  if (messages.length === 0 && [...url.searchParams.keys()].some((k) => k !== "key")) {
    messages = extractInboundMessages(Object.fromEntries(url.searchParams));
  }

  if (messages.length === 0) {
    // Most likely a status-only batch, which belongs to the delivery-status
    // hook. Logged so an unrecognised envelope is diagnosable, without echoing
    // the payload itself — these carry candidate phone numbers.
    logger.info("wa_webhook_no_messages", { keys: body && typeof body === "object" ? Object.keys(body) : null });
    return NextResponse.json({ ok: true, received: 0 });
  }

  const summary = await ingestInboundMessages(messages, config);

  // Only a genuine storage failure earns a retry — see the note above.
  if (summary.failed > 0) {
    return NextResponse.json({ ok: false, ...summary }, { status: 502 });
  }
  return NextResponse.json({ ok: true, ...summary });
}

export async function POST(req: Request) {
  return handle(req);
}

/**
 * Meta's webhook VERIFICATION handshake, which is a GET carrying
 * `hub.mode=subscribe`, `hub.verify_token` and `hub.challenge`; the challenge
 * must be echoed as bare text or the subscription is refused. Verified against
 * the same shared secret, so there is one value to configure rather than two.
 *
 * Any other GET is treated as a manual test of the POST path.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && challenge) {
    // Either secret satisfies the handshake. Meta's verify_token is a value we
    // choose in their dashboard, so a deployment configured for signature auth
    // alone would otherwise be unable to complete the subscription — and would
    // therefore never receive a signed request to verify in the first place.
    const [mirrorSecret, appSecret] = await Promise.all([
      getSetting(WA_MIRROR_SECRET_KEY).catch(() => null),
      getSetting(WA_CLOUD_APP_SECRET_KEY).catch(() => null),
    ]);
    const accepted = [mirrorSecret?.trim(), appSecret?.trim() || process.env.WA_CLOUD_APP_SECRET]
      .map((s) => s?.trim())
      .filter((s): s is string => !!s);

    const provided = token?.trim() ?? "";
    if (accepted.length === 0 || !accepted.includes(provided)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }

  return handle(req);
}
