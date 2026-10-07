import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { addDays, todayIst } from "@/lib/lead-pulse-dates";
import { requireBank } from "@/lib/bank/access";
import { ERROR_LABEL, toBankError } from "@/lib/bank/errors";
import { getMessage, gmailAccessToken, gmailProfileEmail, searchMessageIds } from "@/lib/bank/gmail";
import { extractStatementUrl, gmailQuery, matchesIntegration, parseSubjectPeriod, resolveSubjectPattern } from "@/lib/bank/email-parse";
import { redact, unseal } from "@/lib/bank/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Schema = z.object({ integrationId: z.string().min(1) });

/**
 * POST /api/finance/bank-automation/test-email — "Test Gmail": can the
 * mailbox be read, and how many statement e-mails match in the last 30 days.
 * Returns dates and counts only — never the link or the e-mail body.
 */
export const POST = withApiHandler(async (req: Request) => {
  await requireBank("manage");
  const { integrationId } = Schema.parse(await req.json());
  const i = await prisma.bankIntegration.findUniqueOrThrow({ where: { id: integrationId }, include: { mailbox: true } });
  if (!i.mailbox) return NextResponse.json({ ok: false, message: "No Gmail mailbox is connected" });
  try {
    const token = await gmailAccessToken(unseal(i.mailbox.refreshTokenEnc, "gmail-refresh-token"));
    const mailbox = await gmailProfileEmail(token);
    const today = todayIst();
    const subject = resolveSubjectPattern(i.emailSubjectPattern, i.accountLastFour);
    const ids = await searchMessageIds(
      token,
      gmailQuery({ sender: i.emailSender, subject, afterIso: addDays(today, -30), beforeIso: addDays(today, 1) }),
      60,
    );
    let matched = 0;
    let latest: { receivedAt: string; period: string | null; hasLink: boolean; hasAttachment: boolean } | null = null;
    for (const id of ids) {
      const m = await getMessage(token, id);
      if (!matchesIntegration({ from: m.from, subject: m.subject }, { sender: i.emailSender, subjectPattern: i.emailSubjectPattern, last4: i.accountLastFour })) continue;
      matched++;
      if (!latest || m.receivedAt.toISOString() > latest.receivedAt) {
        const p = parseSubjectPeriod(m.subject);
        latest = {
          receivedAt: m.receivedAt.toISOString(),
          period: p ? `${p.start} → ${p.end}` : null,
          hasLink: !!extractStatementUrl(m.bodies, i.bankCode),
          hasAttachment: !!m.attachment,
        };
      }
    }
    await prisma.bankMailboxConnection.update({ where: { id: i.mailbox.id }, data: { lastCheckedAt: new Date(), lastError: null } });
    return NextResponse.json({ ok: true, mailbox, matched, latest });
  } catch (e) {
    const err = toBankError(e);
    return NextResponse.json({ ok: false, code: err.code, message: `${ERROR_LABEL[err.code]} — ${redact(err.message)}` });
  }
});
