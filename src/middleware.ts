import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const useSecure = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
const cookieName = useSecure
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";

export async function middleware(req: NextRequest) {
  // getToken validates BOTH the session cookie (web) and an
  // `Authorization: Bearer <jwt>` header (mobile) — it decodes the header token
  // with the same secret (next-auth/jwt), so a valid mobile token passes here
  // and a forged/expired one yields null, exactly like a bad cookie. This gate
  // is therefore unchanged; only the *unauthenticated response* differs below.
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName,
    secureCookie: useSecure,
  });

  if (!token) {
    // JSON 401 for API callers (mobile/fetch), login redirect for page loads.
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on every path except: auth/health endpoints, the login page,
    // external integration webhooks (api/integrations, and the two Wabis
    // webhooks under api/crm/integrations/wabis — inbound replies + delivery
    // status — which authenticate with their own shared `wabis_inbound_secret`,
    // not a logged-in session; the parent wabis admin endpoints stay gated),
    // the WhatsApp conversation-mirror hook (api/crm/wa/webhook — same reason:
    // a message provider POSTs with a shared `wa_mirror_secret` and has no
    // session; every OTHER route under api/crm/wa stays gated),
    // the public privacy policy page (required to be reachable without login
    // for Meta app review), the public careers site and its apply endpoint
    // (`careers` + `api/careers` — a job applicant is by definition a stranger
    // with no Desgro login; that endpoint does its own honeypot, dwell-time and
    // rate-limit checks, and every OTHER route under api/hiring stays gated),
    // the offer signing page and its endpoint (`offer` + `api/offer` — the
    // candidate signing has no Desgro login; the single-use, expiring token in
    // the URL is the credential, and it is rate-limited and audited),
    // the external sourcing-partner portal (`partners` + `api/partners` — an
    // agency is not a Desgro user; it authenticates with its own magic-link
    // session cookie, and every query it can reach is scoped by
    // src/lib/hiring/partner-scope.ts),
    // the per-user interview calendar feed (`api/hiring/calendar` — a calendar
    // client subscribes with a URL and cannot carry a session; the URL's HMAC
    // token IS the credential and is checked in constant time),
    // Next.js internal asset routes, and any file with
    // an extension (/desfin.png, /favicon.ico, fonts).
    "/((?!login|api/auth|api/health|api/whoami|api/integrations|api/crm/integrations/wabis/inbound|api/crm/integrations/wabis/delivery-status|api/crm/wa/webhook|psych/test|api/psych/test|privacy-policy|careers|api/careers|offer|api/offer|partners|api/partners|api/hiring/calendar|_next/static|_next/image|.*\\..*).*)",
  ],
};
