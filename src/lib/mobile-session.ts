import { randomUUID } from "node:crypto";
import { decode } from "next-auth/jwt";
import { env } from "./env";

/**
 * One signed-in phone per user for the mobile app. Each app sign-in stores a
 * fresh id on the user (`User.mobileSessionId`) and in its token (`sid`); a
 * token whose id is no longer the user's current one is refused, so signing in
 * on a second phone signs the first one out. Web sessions don't use this.
 */

/** A fresh app-session id. */
export function newMobileSessionId(): string {
  return randomUUID();
}

/** The phone's name as the app reports it ("samsung SM-A546E"), safe to store and show. */
export function cleanDeviceLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return s || null;
}

/**
 * Is this app token still the user's current app session? A token minted
 * before single-session existed carries no `sid`: it stays valid only until the
 * user next signs in on the app (which sets `mobileSessionId`), and it expires
 * within the 8-hour token lifetime anyway.
 */
export function isCurrentMobileSession(current: string | null, tokenSid: string | null): boolean {
  return tokenSid ? current === tokenSid : current === null;
}

/**
 * The app's `Authorization: Bearer <jwt>`, decoded — or null when absent,
 * malformed or expired. Only proves who the token was issued to; callers check
 * `isCurrentMobileSession` and the user's status against the database.
 */
export async function readAppToken(authorization: string | null): Promise<{ uid: string; sid: string | null } | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  try {
    const token = await decode({ token: authorization.slice(7), secret: env.NEXTAUTH_SECRET });
    if (!token?.uid) return null;
    return { uid: String(token.uid), sid: typeof token.sid === "string" ? token.sid : null };
  } catch {
    return null;
  }
}
