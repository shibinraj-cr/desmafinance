import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived token minted when a job page renders, required by the public
 * résumé-parse endpoint.
 *
 * This exists because the defence that makes the apply route safe does not
 * transfer. `rate-limit.ts` is in-process memory — per warm serverless
 * instance, not global — and on apply that is fine, because the database's
 * uniqueness on (candidate, job) makes duplicate submissions pointless however
 * many requests get through. A parse endpoint creates nothing, so it has no
 * such backstop: every call simply costs credits.
 *
 * This does not stop a determined attacker, who can scrape a token as easily as
 * a URL. It stops the case that actually happens — a bare curl loop against a
 * known endpoint — for the price of an HMAC. The real ceiling is the daily
 * budget, which is enforced in the database.
 */
const TTL_MS = 30 * 60_000;

function secret(): string {
  // NEXTAUTH_SECRET is already required for the app to boot, so there is no new
  // configuration to forget. It is only ever used to sign, never sent.
  const s = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required to sign careers tokens");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Mint a token for one job slug. Safe to embed in the page. */
export function mintCareersToken(slug: string, now = Date.now()): string {
  const payload = `${slug}.${now + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a token against the slug it was minted for.
 *
 * Returns a reason rather than a bare boolean so the caller can tell an expired
 * token (the page was left open — mint a new one) from a forged one.
 */
export function verifyCareersToken(
  token: string | null | undefined,
  slug: string,
  now = Date.now(),
): { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "bad_signature" } {
  if (!token) return { ok: false, reason: "missing" };

  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [tokenSlug, expiresAt, mac] = parts as [string, string, string];

  const expected = sign(`${tokenSlug}.${expiresAt}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // Compare before anything else that could leak timing, and length-check
  // first because timingSafeEqual throws on a mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  // Only trust the payload AFTER the signature holds.
  if (tokenSlug !== slug) return { ok: false, reason: "bad_signature" };
  const exp = Number(expiresAt);
  if (!Number.isFinite(exp) || exp < now) return { ok: false, reason: "expired" };

  return { ok: true };
}
