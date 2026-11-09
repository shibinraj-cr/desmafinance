import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parseVoxbayCdr, verifyVoxbaySignature, VOXBAY_HEADERS } from "@/lib/voxbay-webhook";
import { ingestVoxbayCdr, recordVoxbayEvent, type VoxbayEventFields } from "@/lib/voxbay-webhook-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** A CDR is a few hundred bytes; anything this size is not one, and isn't stored. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Voxbay CDR webhook — one POST per finished call, incoming or outgoing.
 *
 * Public (excluded from the session gate in src/middleware.ts); the only
 * credential is X-Voxbay-Signature, an HMAC of the event id, timestamp and RAW
 * body keyed with VOXBAY_SIGNING_SECRET. Without the secret the hook is closed
 * (503), never open.
 *
 * Voxbay waits 10s and treats any 2xx as delivered, so the work is just verify,
 * upsert, answer. Status codes are chosen for its retry schedule:
 *   200  filed, a repeat of a delivery already filed, or a test send (logged only)
 *   400  readable but unusable (no call_id, not JSON) — a retry would fail the same way
 *   401  bad or missing signature
 *   500  the DB write failed — Voxbay retries, and the retry is safe (upsert on call id)
 *
 * Every attempt is logged in VoxbayWebhookEvent, the place to look before
 * re-sending from Voxbay → API Management → Activity.
 */
export async function POST(req: Request) {
  const rawBody = await req.text().catch(() => "");
  const h = req.headers;
  const eventType = h.get(VOXBAY_HEADERS.event)?.trim() || null;
  const eventId = h.get(VOXBAY_HEADERS.eventId)?.trim() || null;
  const attemptRaw = Number(h.get(VOXBAY_HEADERS.attempt));
  const attempt = Number.isInteger(attemptRaw) && attemptRaw > 0 ? attemptRaw : null;
  const isTest = h.get(VOXBAY_HEADERS.test)?.trim().toLowerCase() === "true";

  // The event name is logged as sent: Voxbay documents cdr.incoming, but its
  // naming has also looked like call_end.incoming.
  logger.info("voxbay_webhook_received", { eventType, eventId, attempt, isTest, bytes: rawBody.length });

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  const secret = process.env.VOXBAY_SIGNING_SECRET?.trim();
  if (!secret) {
    logger.error("voxbay_webhook_no_secret", {});
    return NextResponse.json({ error: "VOXBAY_SIGNING_SECRET not set — hook disabled" }, { status: 503 });
  }

  let body: unknown = null;
  try {
    body = rawBody.trim() ? (JSON.parse(rawBody) as unknown) : null;
  } catch {
    body = null;
  }
  const callId =
    body && typeof body === "object" && typeof (body as { call_id?: unknown }).call_id === "string"
      ? ((body as { call_id: string }).call_id.trim() || null)
      : null;
  const event: Omit<VoxbayEventFields, "status" | "error"> = {
    eventId,
    eventType,
    attempt,
    isTest,
    signatureOk: true,
    callId,
    rawBody: body,
  };

  const verdict = verifyVoxbaySignature({ rawBody, eventId, header: h.get(VOXBAY_HEADERS.signature), secret });
  if (verdict !== "valid") {
    logger.warn("voxbay_webhook_bad_signature", { verdict, eventId, attempt });
    // Stored without its event id: the id is only trustworthy once the HMAC
    // over it checks out, so a forged request can't claim a real delivery's row.
    await recordVoxbayEvent(prisma, {
      ...event,
      eventId: null,
      signatureOk: false,
      status: "error",
      error: `signature_${verdict}${eventId ? ` (claimed event ${eventId.slice(0, 200)})` : ""}`,
    }).catch((e) => logger.error("voxbay_webhook_log_failed", { error: String(e) }));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const prior = await prisma.voxbayWebhookEvent.findUnique({ where: { eventId: eventId! }, select: { status: true } });
    if (prior && prior.status !== "error") {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    if (isTest) {
      await recordVoxbayEvent(prisma, { ...event, status: "test" });
      return NextResponse.json({ ok: true, test: true });
    }

    const parsed = body === null ? ({ ok: false, error: "invalid_json" } as const) : parseVoxbayCdr(body, eventType);
    if (!parsed.ok) {
      logger.warn("voxbay_webhook_unusable", { eventId, error: parsed.error });
      await recordVoxbayEvent(prisma, { ...event, status: "error", error: parsed.error });
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const result = await ingestVoxbayCdr(parsed.cdr, event);
    return NextResponse.json({
      ok: true,
      status: result.status,
      linked: !!result.leadId,
      leadCreated: result.leadCreated,
      reInquiry: result.reInquiry,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("voxbay_webhook_failed", { eventId, attempt, error: message });
    await recordVoxbayEvent(prisma, { ...event, status: "error", error: message.slice(0, 2000) }).catch(() => undefined);
    return NextResponse.json({ error: "could not store the call" }, { status: 500 });
  }
}
