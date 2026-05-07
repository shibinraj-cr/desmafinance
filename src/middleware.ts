import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    // Run on every path except: auth/health endpoints, the login page,
    // Next.js internal asset routes, and any file with an extension
    // (covers /desfin.png, /icon.png, /favicon.ico, fonts, etc.).
    "/((?!login|api/auth|api/health|_next/static|_next/image|.*\\..*).*)",
  ],
};
