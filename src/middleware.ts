import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const useSecure = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
const cookieName = useSecure
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";

export async function middleware(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName,
    secureCookie: useSecure,
  });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on every path except: auth/health endpoints, the login page,
    // Next.js internal asset routes, and any file with an extension
    // (covers /desfin.png, /icon.png, /favicon.ico, fonts, etc.).
    "/((?!login|api/auth|api/health|api/whoami|_next/static|_next/image|.*\\..*).*)",
  ],
};
