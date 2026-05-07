import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const useSecure = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
const cookieName = useSecure
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName,
    secureCookie: useSecure,
  });

  return NextResponse.json({
    authenticated: !!token,
    expectedCookieName: cookieName,
    secureMode: useSecure,
    nextauthUrlSet: !!process.env.NEXTAUTH_URL,
    nextauthUrlScheme: (process.env.NEXTAUTH_URL ?? "").split(":")[0] || null,
    secretLength: (process.env.NEXTAUTH_SECRET ?? "").length,
    cookieNamesPresent: req.cookies
      .getAll()
      .map((c) => c.name)
      .filter((n) => n.includes("next-auth")),
    user: token ? { uid: token.uid, role: token.role } : null,
  });
}
