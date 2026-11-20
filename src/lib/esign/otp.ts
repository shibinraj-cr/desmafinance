import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * One-time codes and the short signing session that follows them.
 *
 * Rules (from the module spec): a 6-digit code, valid for 10 minutes, stored
 * only as a hash; five wrong tries lock the signer out for 30 minutes. A
 * correct code opens a signing session — an HMAC-signed cookie bound to the
 * signer AND to their current link, so resending a link (new token) ends any
 * session opened with the old one.
 *
 * Asking for another code does NOT cancel the earlier ones: each stays good
 * for its own 10 minutes (the newest OTP_MAX_LIVE of them). On a phone the
 * client leaves the page to read the email, the page often reloads, they ask
 * again — and then type the code they just read. Cancelling it on every resend
 * turned that into a loop of "wrong code" on mobile.
 */

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCK_MS = 30 * 60 * 1000;
export const SESSION_TTL_MS = 60 * 60 * 1000;
/** Codes usable at once. Matches the five-codes-an-hour send limit. */
export const OTP_MAX_LIVE = 5;

export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(signerId: string, code: string): string {
  return createHash("sha256").update(`esign-otp:${signerId}:${code}`).digest("hex");
}

type OtpState = { otpHash: string | null; otpExpiresAt: Date | null; otpAttempts: number; otpLockedUntil: Date | null };

type StoredCode = { hash: string; expiresAt: number };

/**
 * `otpHash` holds the outstanding codes, oldest first, as space-separated
 * `<sha256 hex>@<expiry ms>`. A bare hash (stored before codes could overlap)
 * expires at `otpExpiresAt`, which always carries the newest code's expiry.
 */
export function readStoredCodes(otpHash: string | null, otpExpiresAt: Date | null): StoredCode[] {
  if (!otpHash) return [];
  const out: StoredCode[] = [];
  for (const part of otpHash.split(/\s+/)) {
    const [hash, exp] = part.split("@");
    const expiresAt = exp === undefined ? (otpExpiresAt?.getTime() ?? 0) : Number(exp);
    if (/^[0-9a-f]{64}$/.test(hash) && Number.isFinite(expiresAt)) out.push({ hash, expiresAt });
  }
  return out;
}

const writeStoredCodes = (codes: StoredCode[]): string | null =>
  codes.length ? codes.map((c) => `${c.hash}@${c.expiresAt}`).join(" ") : null;

/** The stored state after sending `code`: earlier codes still inside their 10 minutes are kept. */
export function addOtpCode(
  state: Pick<OtpState, "otpHash" | "otpExpiresAt">,
  signerId: string,
  code: string,
  now: Date,
): { otpHash: string; otpExpiresAt: Date } {
  const expiresAt = now.getTime() + OTP_TTL_MS;
  const live = readStoredCodes(state.otpHash, state.otpExpiresAt).filter((c) => c.expiresAt > now.getTime());
  const codes = [...live, { hash: hashOtp(signerId, code), expiresAt }].slice(-OTP_MAX_LIVE);
  return { otpHash: writeStoredCodes(codes)!, otpExpiresAt: new Date(expiresAt) };
}

export type OtpCheck =
  | { ok: true }
  | { ok: false; reason: "locked"; lockedUntil: Date }
  | { ok: false; reason: "expired" | "none" }
  | { ok: false; reason: "wrong"; attemptsLeft: number; lockedUntil: Date | null };

/** Judge a typed code. Pure: the caller persists `nextState` either way. */
export function checkOtp(
  state: OtpState,
  signerId: string,
  code: string,
  now: Date,
): { result: OtpCheck; nextState: Partial<OtpState> } {
  if (state.otpLockedUntil && state.otpLockedUntil > now) {
    return { result: { ok: false, reason: "locked", lockedUntil: state.otpLockedUntil }, nextState: {} };
  }
  const codes = readStoredCodes(state.otpHash, state.otpExpiresAt);
  if (!codes.length) return { result: { ok: false, reason: "none" }, nextState: {} };
  const live = codes.filter((c) => c.expiresAt > now.getTime());
  if (!live.length) return { result: { ok: false, reason: "expired" }, nextState: { otpHash: null } };

  const typed = code.trim();
  const given = Buffer.from(hashOtp(signerId, typed), "hex");
  // Compare against every stored code, without stopping early.
  let hit: StoredCode | null = null;
  for (const c of codes) {
    if (timingSafeEqual(given, Buffer.from(c.hash, "hex"))) hit = c;
  }
  if (hit && !/^\d{6}$/.test(typed)) hit = null;
  if (hit && hit.expiresAt > now.getTime()) {
    // One use only: a correct code spends every outstanding code.
    return { result: { ok: true }, nextState: { otpHash: null, otpAttempts: 0, otpLockedUntil: null } };
  }
  if (hit) {
    // A real code, just past its 10 minutes while a newer one is still live. Not a guess, so no try is used.
    return { result: { ok: false, reason: "expired" }, nextState: {} };
  }
  const attempts = state.otpAttempts + 1;
  if (attempts >= OTP_MAX_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + OTP_LOCK_MS);
    return {
      result: { ok: false, reason: "wrong", attemptsLeft: 0, lockedUntil },
      nextState: { otpAttempts: 0, otpHash: null, otpLockedUntil: lockedUntil },
    };
  }
  return { result: { ok: false, reason: "wrong", attemptsLeft: OTP_MAX_ATTEMPTS - attempts, lockedUntil: null }, nextState: { otpAttempts: attempts } };
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

/** Cookie name per signer, so two signers on one browser do not collide. */
export function sessionCookieName(signerId: string): string {
  return `esign_${signerId.slice(-12)}`;
}

/** A session value: expiry + MAC over (signer, current link hash, expiry). */
export function mintSession(signerId: string, tokenHash: string, now: Date): string {
  const exp = now.getTime() + SESSION_TTL_MS;
  return `${exp}.${mac(`${signerId}|${tokenHash}|${exp}`)}`;
}

export function verifySession(value: string | undefined, signerId: string, tokenHash: string, now: Date): boolean {
  if (!value) return false;
  const [expRaw, sig] = value.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= now.getTime() || !sig) return false;
  const want = Buffer.from(mac(`${signerId}|${tokenHash}|${exp}`));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
