/**
 * Verifying that an inbound webhook really came from Meta.
 *
 * Meta signs every webhook POST with `X-Hub-Signature-256`: HMAC-SHA256 of the
 * RAW request body, keyed with the app secret. That is strictly stronger than
 * the shared secret the Wabis-era hooks use, because a shared secret in a query
 * string leaks into logs and proxies and never proves the body is intact.
 *
 * Two details are easy to get wrong and both are load-bearing:
 *
 *   - The signature covers the raw bytes, so the body must be verified BEFORE
 *     it is parsed. `JSON.parse` then `JSON.stringify` does not round-trip
 *     byte-for-byte (key order, unicode escapes, whitespace), so re-serialising
 *     produces a different digest and every request fails.
 *   - Comparison must be timing-safe. A plain `===` leaks the correct digest one
 *     byte at a time to anyone willing to send enough requests.
 *
 * Verification is OPTIONAL by design: with no app secret configured, the caller
 * falls back to the shared-secret check. That keeps the endpoint usable while
 * relaying through Wabis (which cannot produce a Meta signature) without ever
 * leaving it open.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const WA_SIGNATURE_HEADER = "x-hub-signature-256";

export type SignatureVerdict = "valid" | "invalid" | "missing" | "not_configured";

/**
 * Check a raw body against Meta's signature header.
 *
 * `missing` and `not_configured` are distinct on purpose: one means the sender
 * did not sign (so fall back), the other means we hold no secret to check with.
 * Collapsing them would make "we cannot verify" indistinguishable from "they
 * did not sign", and the caller needs to treat those differently.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null | undefined,
  appSecret: string | null | undefined,
): SignatureVerdict {
  const secret = (appSecret ?? "").trim();
  if (!secret) return "not_configured";

  const provided = (header ?? "").trim();
  if (!provided) return "missing";
  if (!provided.startsWith("sha256=")) return "invalid";

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const got = provided.slice("sha256=".length);

  // timingSafeEqual throws on a length mismatch, which is itself a leak-free
  // signal — an attacker learns only that the length was wrong, which the hex
  // digest's fixed length already tells them.
  if (got.length !== expected.length) return "invalid";

  try {
    return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex")) ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}
