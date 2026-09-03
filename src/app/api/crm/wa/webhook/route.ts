import { NextResponse } from "next/server";
import { getSetting, WA_CLOUD_APP_SECRET_KEY, WA_MIRROR_SECRET_KEY } from "@/lib/app-settings";
import { extractInboundMessages } from "@/lib/wa/inbound";
import { getWaMirrorConfig, ingestInboundMessages } from "@/lib/wa/mirror";
import { verifyMetaSignature, WA_SIGNATURE_HEADER } from "@/lib/wa/signature";
import { logger } from "@/lib/logger";
import { applyDeliveryStatuses, extractDeliveryStatuses } from "@/lib/wa/delivery-status";
import { extractTemplateStatusUpdates } from "@/lib/wa/template-status";
import { applyTemplateStatusUpdates } from "@/lib/wa/templates";

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
 * Also carries two things that are not messages at all and share the same
 * subscription: delivery statuses, and TEMPLATE approval events. Both are
 * handled here rather than at their own endpoints because Meta delivers them to
 * one callback URL and there is no way to split them upstream.
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

  const body = parseJson(rawBody);

  // Template APPROVALS ride the same subscription, on their own field — and are
  // handled ABOVE the mirror gate on purpose. `wa_mirror_enabled` governs
  // storing candidates' conversations, which is a different decision from
  // wanting to know Meta approved a template; someone running with the mirror
  // off would otherwise never hear back about a submission.
  //
  // This only fires while the app is subscribed to
  // `message_template_status_update`, a separate checkbox from `messages` on
  // the WABA subscription. The sync in CRM → Templates is the backstop.
  const templateUpdates = extractTemplateStatusUpdates(body);
  const templatesApplied =
    templateUpdates.length > 0
      ? await applyTemplateStatusUpdates(templateUpdates).catch((e) => {
          // A template status is a cache of Meta's answer and a sync settles it
          // anyway, so a storage failure is not worth asking Meta to redeliver
          // the batch — which would redeliver the messages alongside it.
          logger.warn("wa_template_status_apply_failed", { message: e instanceof Error ? e.message : String(e) });
          return 0;
        })
      : 0;

  const config = await getWaMirrorConfig();
  if (!config.enabled) {
    return NextResponse.json({ ok: true, skipped: "mirror_disabled", templates: templatesApplied });
  }

  // Body first, query string second. A GET-with-query-params relay is a shape
  // this team already configures — both pre-existing Wabis hooks read fields
  // from the body OR the query for exactly that reason — and a bare test curl
  // is the fastest way to prove the endpoint is wired at all.
  let messages = extractInboundMessages(body);
  if (messages.length === 0 && [...url.searchParams.keys()].some((k) => k !== "key")) {
    messages = extractInboundMessages(Object.fromEntries(url.searchParams));
  }

  // Statuses ride the SAME subscription as messages, and were being thrown away
  // here — which is why every message the CRM ever sent showed one grey tick
  // forever. Handled before the empty-batch return, because a status-only batch
  // is the common case: one send produces one message and then three callbacks.
  const statuses = extractDeliveryStatuses(body);
  if (statuses.length > 0) {
    const applied = await applyDeliveryStatuses(statuses);
    if (messages.length === 0) {
      return NextResponse.json({ ok: true, received: 0, statuses: applied, templates: templatesApplied });
    }
  }


  if (messages.length === 0) {
    // Neither a message nor a status we recognise. Logged so an unfamiliar
    // envelope is diagnosable, without echoing the payload itself — these carry
    // candidate phone numbers.
    // A template event carries no messages, so it would land here and be
    // logged as an unrecognised envelope — hence the count in the answer.
    if (templatesApplied === 0) {
      logger.info("wa_webhook_no_messages", { keys: body && typeof body === "object" ? Object.keys(body) : null });
    }
    return NextResponse.json({ ok: true, received: 0, templates: templatesApplied });
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
