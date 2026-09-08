/**
 * A small fixed-window limiter for the PUBLIC careers endpoints.
 *
 * Honest about what it is: in-process memory, so on serverless it is per-warm-
 * instance rather than global. It is one of four layers, not the whole defence:
 *
 *   1. a honeypot field no human fills in,
 *   2. a minimum time-on-form (a bot posts instantly),
 *   3. this limiter, which stops a single instance being hammered,
 *   4. the database's own uniqueness — one application per (candidate, job) —
 *      which is what actually makes duplicate spam pointless.
 *
 * Swapping in Redis later means replacing this file and nothing else.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Keep the map from growing without bound on a long-lived instance. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  existing.count++;
  if (existing.count > limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** Test seam — the limiter is module state, so tests need a way to clear it. */
export function resetRateLimits(): void {
  buckets.clear();
}
