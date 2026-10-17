import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * One-time codes and the short signing session that follows them.
 *
 * Rules (from the module spec): a 6-digit code, valid for 10 minutes, stored
 * only as a hash; five wrong tries lock the signer out for 30 minutes. A
 * correct code opens a signing session — an HMAC-signed cookie bound to the
 * signer AND to their current link, so resending a link (new token) ends any
 * session opened with the old one.
 */

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCK_MS = 30 * 60 * 1000;
export const SESSION_TTL_MS = 60 * 60 * 1000;

export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(signerId: string, code: string): string {
  return createHash("sha256").update(`esign-otp:${signerId}:${code}`).digest("hex");
}

type OtpState = { otpHash: string | null; otpExpiresAt: Date | null; otpAttempts: number; otpLockedUntil: Date | null };

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
  if (!state.otpHash) return { result: { ok: false, reason: "none" }, nextState: {} };
  if (!state.otpExpiresAt || state.otpExpiresAt <= now) {
    return { result: { ok: false, reason: "expired" }, nextState: { otpHash: null } };
  }
  const given = Buffer.from(hashOtp(signerId, code.trim()), "hex");
  const want = Buffer.from(state.otpHash, "hex");
  if (/^\d{6}$/.test(code.trim()) && given.length === want.length && timingSafeEqual(given, want)) {
    // One use only.
    return { result: { ok: true }, nextState: { otpHash: null, otpAttempts: 0, otpLockedUntil: null } };
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
