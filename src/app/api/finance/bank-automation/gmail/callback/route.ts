import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { siteBaseUrl } from "@/lib/site-url";
import { logger } from "@/lib/logger";
import { BANK_PAGE, bankCaps } from "@/lib/bank/access";
import { logEvent } from "@/lib/bank/events";
import { GMAIL_CALLBACK_PATH, emailFromIdToken, exchangeGmailCode, gmailProfileEmail, revokeGoogleToken } from "@/lib/bank/gmail";
import { redact, seal } from "@/lib/bank/secrets";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "bank_gmail_state";

/**
 * GET /api/finance/bank-automation/gmail/callback — Google redirects here.
 * Seals the refresh token, attaches the mailbox to the integration, and
 * refuses a mailbox other than the integration's configured recipient (the
 * usual mistake: consenting with a personal account in the same browser).
 */
export async function GET(req: Request) {
  const base = siteBaseUrl(req);
  const page = `${base}${BANK_PAGE}?tab=automation`;
  const back = (status: string) => {
    const res = NextResponse.redirect(`${page}&gmail=${encodeURIComponent(status)}`);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/finance/bank-automation/gmail", maxAge: 0 });
    return res;
  };

  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.redirect(`${base}/login`);
  if (!bankCaps(perms).manage) return NextResponse.redirect(`${base}/finance/overview`);

  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const [nonce, integrationId] = (cookies().get(STATE_COOKIE)?.value ?? "").split(".");
  if (!code || !state || !nonce || state !== nonce || !integrationId) return back("bad_state");

  const integration = await prisma.bankIntegration.findUnique({ where: { id: integrationId } });
  if (!integration) return back("bad_request");

  let refreshToken: string;
  let email: string | null;
  let scope: string | null;
  try {
    const t = await exchangeGmailCode(code, `${base}${GMAIL_CALLBACK_PATH}`);
    if (!t.refresh_token) return back("no_refresh_token");
    refreshToken = t.refresh_token;
    scope = t.scope ?? null;
    email = emailFromIdToken(t.id_token) ?? (await gmailProfileEmail(t.access_token));
  } catch (e) {
    logger.error("bank_gmail_oauth_failed", { message: redact(e instanceof Error ? e.message : String(e)) });
    return back("exchange_failed");
  }
  if (!email) {
    await revokeGoogleToken(refreshToken);
    return back("no_email");
  }
  if (integration.emailRecipient && integration.emailRecipient.toLowerCase() !== email) {
    await revokeGoogleToken(refreshToken);
    return back("wrong_mailbox");
  }

  const mailbox = await prisma.bankMailboxConnection.upsert({
    where: { emailAddress: email },
    create: { emailAddress: email, refreshTokenEnc: seal(refreshToken, "gmail-refresh-token"), scope, connectedById: userId },
    update: { refreshTokenEnc: seal(refreshToken, "gmail-refresh-token"), scope, connectedById: userId, lastError: null },
  });
  await prisma.bankIntegration.update({
    where: { id: integration.id },
    data: { mailboxConnectionId: mailbox.id, emailRecipient: integration.emailRecipient ?? email, updatedById: userId },
  });
  await recordAudit({ entityType: "BankMailboxConnection", entityId: mailbox.id, action: "CREATE", userId, changes: { integrationId: integration.id } });
  await logEvent({ integrationId: integration.id, step: "gmail", message: "Gmail mailbox connected", userId });
  return back("connected");
}
