import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { getHiringEmailConfig } from "@/lib/hiring/email";
import { sendEmail, friendlySmtpError, formatFrom } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({ to: z.string().trim().email().optional() });

/**
 * POST /api/hiring/email-sender/test — send one email with the hiring settings.
 *
 * Worth a route of its own because the failure this exists to catch is silent:
 * Google accepts a send and quietly rewrites the From to the login mailbox, so
 * the only way to know which address a candidate will actually see is to look
 * at a delivered message. The response reports the From that was USED, and the
 * mail says it too.
 */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("team:manage");
  const body = schema.parse(await req.json().catch(() => ({})));

  const cfg = await getHiringEmailConfig();
  if (!cfg) throw badRequest("No email account is configured yet.", "not_configured");

  const to =
    body.to ??
    (await prisma.user.findUnique({ where: { id: access.userId }, select: { email: true } }))?.email;
  if (!to) throw badRequest("There is no address to send the test to.", "no_recipient");

  const from = formatFrom(cfg);
  try {
    await sendEmail(cfg, {
      to,
      subject: "Desgro hiring — sender test",
      text:
        `This is a test of the address candidates will see on hiring email.\n\n` +
        `Desgro asked to send as: ${from}\n\n` +
        `Check the From line on this message. If it shows a different address, ` +
        `Google rewrote it — that mailbox has not been granted to the sending ` +
        `account. Replies to this message go to: ${cfg.replyTo ?? from}\n`,
    });
  } catch (e) {
    throw badRequest(friendlySmtpError(e), "send_failed");
  }

  return NextResponse.json({ ok: true, to, from, replyTo: cfg.replyTo ?? null });
});
