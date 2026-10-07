import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { siteBaseUrl } from "@/lib/site-url";
import { BANK_PAGE, bankCaps } from "@/lib/bank/access";
import { GMAIL_CALLBACK_PATH, bankGoogleOAuthConfig, buildGmailAuthUrl } from "@/lib/bank/gmail";

export const dynamic = "force-dynamic";

const GMAIL_STATE_COOKIE = "bank_gmail_state";

/**
 * GET /api/finance/bank-automation/gmail/connect?integrationId=&sheets=1 —
 * starts Google consent for the statement mailbox (gmail.readonly, plus
 * spreadsheets when Sheets sync is wanted). A random state is bound to an
 * httpOnly cookie and checked on return, so a forged callback cannot attach
 * a mailbox.
 */
export async function GET(req: Request) {
  const base = siteBaseUrl(req);
  const page = `${base}${BANK_PAGE}?tab=automation`;
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.redirect(`${base}/login`);
  if (!bankCaps(perms).manage) return NextResponse.redirect(`${base}/finance/overview`);
  if (!bankGoogleOAuthConfig()) return NextResponse.redirect(`${page}&gmail=not_configured`);

  const url = new URL(req.url);
  const integrationId = url.searchParams.get("integrationId") ?? "";
  if (!/^[a-z0-9]{10,40}$/i.test(integrationId)) return NextResponse.redirect(`${page}&gmail=bad_request`);
  const sheets = url.searchParams.get("sheets") === "1";

  const nonce = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildGmailAuthUrl(`${base}${GMAIL_CALLBACK_PATH}`, nonce, sheets));
  res.cookies.set(GMAIL_STATE_COOKIE, `${nonce}.${integrationId}`, {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/api/finance/bank-automation/gmail",
    maxAge: 600,
  });
  return res;
}
