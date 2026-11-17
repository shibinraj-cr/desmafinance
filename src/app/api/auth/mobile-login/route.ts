import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { newMobileSessionId, cleanDeviceLabel } from "@/lib/mobile-session";

export const dynamic = "force-dynamic";

// Match the web session lifetime (authOptions.session.maxAge = 8h).
const MAX_AGE = 60 * 60 * 8;

// A throwaway hash to run bcrypt.compare against when the username is unknown
// (or has no password set), so login timing is constant and can't be used to
// enumerate valid usernames. Computed once at module load.
const DUMMY_HASH = bcrypt.hashSync("desgro-timing-guard", 10);

const Body = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  /** The phone's name, shown to the phone this sign-in replaces. Older app builds don't send it. */
  device: z.string().optional(),
});

/**
 * POST /api/auth/mobile-login — token login for the native app.
 *
 * Mirrors the credentials `authorize()` in src/lib/auth.ts (lowercase-trim
 * username, bcrypt compare, reject deactivated), then returns a JWT minted with
 * next-auth's own `encode()` and the SAME NEXTAUTH_SECRET + `{ uid, role }`
 * shape as the web cookie — so `getCurrentUserAndPermissions()`'s bearer path
 * (and middleware's getToken) accept it without any special handling.
 *
 * One signed-in phone per user: every sign-in stores a fresh session id on the
 * user and in the token (`sid`), which signs out any other phone on its next
 * request (src/lib/mobile-session.ts). The web session is unaffected.
 *
 * This route sits under /api/auth, which the middleware matcher already
 * excludes, so the unauthenticated login request reaches it.
 */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { username: parsed.data.username.trim().toLowerCase() },
  });
  // Always run bcrypt.compare (against a dummy hash when the user is missing or
  // has no hash) so the response takes the same time whether or not the username
  // exists — no timing oracle, no null-hash throw. Uniform 401 on any failure.
  const passwordOk = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.isActive) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const sid = newMobileSessionId();
  await prisma.user.update({
    where: { id: user.id },
    data: { mobileSessionId: sid, mobileSessionAt: new Date(), mobileSessionDevice: cleanDeviceLabel(parsed.data.device) },
  });

  const token = await encode({
    token: { uid: user.id, role: user.role, sid },
    secret: env.NEXTAUTH_SECRET,
    maxAge: MAX_AGE,
  });

  return NextResponse.json({
    token,
    expiresIn: MAX_AGE,
    user: { id: user.id, username: user.username, email: user.email ?? null, role: user.role },
  });
}
