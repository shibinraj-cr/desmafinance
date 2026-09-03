import { NextResponse } from "next/server";
import { siteBaseUrl } from "@/lib/site-url";
import { consumeMagicLink, PARTNER_COOKIE } from "@/lib/hiring/partner-scope";

export const dynamic = "force-dynamic";

/**
 * GET /api/partners/login/[token] — the emailed magic link lands here.
 *
 * A ROUTE HANDLER rather than a page on purpose: Next only permits setting a
 * cookie from a route handler or a server action, so doing this during a page
 * render throws at runtime. Redirecting afterwards also leaves the one-time
 * token behind in history instead of parking it in the address bar.
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const result = await consumeMagicLink(params.token);

  const url = new URL(result ? "/partners" : "/partners/expired", siteBaseUrl(req));
  const response = NextResponse.redirect(url, { status: 303 });

  if (result) {
    response.cookies.set(PARTNER_COOKIE, params.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.NEXTAUTH_URL ?? "").startsWith("https://"),
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
  }

  return response;
}
