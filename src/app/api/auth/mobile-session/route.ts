import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAppToken, isCurrentMobileSession, newMobileSessionId } from "@/lib/mobile-session";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/mobile-session — why the app's token stopped working, so the
 * phone can say so when it signs out:
 *   active   — still the user's current app session
 *   replaced — the account signed in on another phone (`at`, `device`)
 *   inactive — the account was deactivated
 *   expired  — no token, or it's malformed / past its 8 hours
 * Answers only the token's own holder, about their own sign-in.
 *
 * DELETE — sign out of the app: retires the token's session so it can't be
 * reused. A phone that was already replaced changes nothing, so it can't sign
 * out the phone that replaced it.
 *
 * Under /api/auth, which the middleware lets through without a session; the
 * token is checked here.
 */
export async function GET(req: Request) {
  const token = await readAppToken(req.headers.get("authorization"));
  if (!token) return NextResponse.json({ status: "expired" });
  const user = await prisma.user.findUnique({
    where: { id: token.uid },
    select: { isActive: true, mobileSessionId: true, mobileSessionAt: true, mobileSessionDevice: true },
  });
  if (!user || !user.isActive) return NextResponse.json({ status: "inactive" });
  if (!isCurrentMobileSession(user.mobileSessionId, token.sid)) {
    return NextResponse.json({ status: "replaced", at: user.mobileSessionAt, device: user.mobileSessionDevice });
  }
  return NextResponse.json({ status: "active" });
}

export async function DELETE(req: Request) {
  const token = await readAppToken(req.headers.get("authorization"));
  if (token?.sid) {
    await prisma.user.updateMany({
      where: { id: token.uid, mobileSessionId: token.sid },
      data: { mobileSessionId: newMobileSessionId(), mobileSessionAt: null, mobileSessionDevice: null },
    });
  }
  return NextResponse.json({ ok: true });
}
