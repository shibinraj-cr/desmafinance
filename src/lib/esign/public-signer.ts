import { cookies } from "next/headers";
import { HttpError, notFound } from "@/lib/http-error";
import { rateLimit } from "@/lib/hiring/rate-limit";
import { requestOrigin } from "@/lib/esign/events";
import { sessionCookieName, verifySession, SESSION_TTL_MS } from "@/lib/esign/otp";
import { resolveLink, type LinkState } from "@/lib/esign/signing";

/**
 * Shared guard for the public signing API. The link is the first credential,
 * the one-time code's session cookie the second; every route is rate-limited
 * per IP because these endpoints face the open internet.
 */
export async function publicSigner(
  req: Request,
  token: string,
  opts: { needSession: boolean; allow?: Array<LinkState["kind"]> },
) {
  const origin = requestOrigin(req);
  if (!rateLimit(`esign:public:${origin.ip ?? "unknown"}`, 60, 10 * 60 * 1000).ok) {
    throw new HttpError(429, "Too many requests. Wait a few minutes and try again.", "rate_limited");
  }
  const state = await resolveLink(token);
  if (state.kind === "invalid") throw notFound("This signing link is not valid.");
  const allowed = opts.allow ?? ["open"];
  if (!allowed.includes(state.kind)) {
    const message: Record<string, string> = {
      expired: "This signing link has expired. Ask DESMA for a new one.",
      cancelled: "This agreement was cancelled.",
      declined: "This agreement was declined.",
      done: "You have already signed this agreement.",
      waiting_turn: "This agreement is not ready for you to sign yet.",
    };
    throw new HttpError(409, message[state.kind] ?? "This agreement is not open for signing.", state.kind);
  }
  const { request, signer } = state as Extract<LinkState, { request: unknown }>;
  if (opts.needSession) {
    const value = cookies().get(sessionCookieName(signer.id))?.value;
    if (!verifySession(value, signer.id, signer.tokenHash ?? "", new Date())) {
      throw new HttpError(401, "Confirm your one-time code first.", "otp_required");
    }
  }
  return { request, signer, origin };
}

export function setSignerSession(signerId: string, value: string) {
  cookies().set(sessionCookieName(signerId), value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}
