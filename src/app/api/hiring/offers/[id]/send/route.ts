import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, unprocessable } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { siteBaseUrl } from "@/lib/site-url";
import { getEmailConfig, sendEmail } from "@/lib/mailer";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit, clientIp } from "@/lib/hiring/audit";
import { sendBlockers } from "@/lib/hiring/offers";
import { createEnvelope, signingUrl, type LetterData } from "@/lib/hiring/envelope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/hiring/offers/[id]/send — mint an envelope and email the signing link.
 *
 * The email is NOT best-effort here, unlike the careers acknowledgement: the
 * link exists only in that message, and an offer marked "sent" that nobody
 * received is a candidate waiting for something that never arrives. If the send
 * fails, the offer stays where it was and says why.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("offer:manage");

  const offer = await prisma.hiringOffer.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      location: { select: { name: true } },
      application: {
        select: {
          id: true,
          candidate: { select: { fullName: true, email: true } },
          job: { select: { compMinLakh: true, compMaxLakh: true } },
        },
      },
    },
  });
  if (!offer) throw notFound("That offer no longer exists.");

  const blockers = sendBlockers({
    status: offer.status,
    baseLakh: Number(offer.baseLakh),
    approvedAt: offer.approvedAt,
    expiresAt: offer.expiresAt,
    job: {
      compMinLakh: offer.application.job.compMinLakh == null ? null : Number(offer.application.job.compMinLakh),
      compMaxLakh: offer.application.job.compMaxLakh == null ? null : Number(offer.application.job.compMaxLakh),
    },
    candidateEmail: offer.application.candidate.email,
  });
  if (blockers.length) {
    return NextResponse.json({ error: "cannot_send", blockers }, { status: 422 });
  }

  const cfg = await getEmailConfig();
  if (!cfg) {
    throw unprocessable(
      "Email is not configured, so the signing link cannot be sent. Set it up on CRM → Settings → Integrations first.",
      "email_unconfigured",
    );
  }

  const letter: LetterData = {
    candidateName: offer.application.candidate.fullName,
    jobTitle: offer.jobTitle,
    department: offer.department,
    locationName: offer.location?.name ?? null,
    startDate: offer.startDate,
    baseLakh: Number(offer.baseLakh),
    variableLakh: offer.variableLakh == null ? null : Number(offer.variableLakh),
    joiningBonusLakh: offer.joiningBonusLakh == null ? null : Number(offer.joiningBonusLakh),
    probationMonths: offer.probationMonths,
    noticePeriodDays: offer.noticePeriodDays,
    otherTermsMd: offer.otherTermsMd,
    expiresAt: offer.expiresAt,
  };

  const { envelopeId, rawToken } = await createEnvelope({
    offerId: offer.id,
    signerName: offer.application.candidate.fullName,
    signerEmail: offer.application.candidate.email!,
    letter,
    ip: clientIp(),
    userAgent: req.headers.get("user-agent"),
  });

  const url = signingUrl(siteBaseUrl(req), rawToken);
  const firstName = offer.application.candidate.fullName.trim().split(/\s+/)[0];

  try {
    await sendEmail(cfg, {
      to: offer.application.candidate.email!,
      subject: `Your offer from DESMA International — ${offer.jobTitle}`,
      text:
        `Hi ${firstName},\n\n` +
        `We would like to offer you the ${offer.jobTitle} role at DESMA International.\n\n` +
        `Read the offer and sign it here:\n${url}\n\n` +
        (offer.expiresAt
          ? `The link is open until ${offer.expiresAt.toDateString()}.\n\n`
          : "") +
        `This link is personal to you — please don't forward it.\n\n` +
        `— DESMA International`,
    });
  } catch (e) {
    // The envelope exists but nobody has the link; remove it rather than leave
    // a live signing token nobody can account for.
    await prisma.hiringOfferEnvelope.delete({ where: { id: envelopeId } }).catch(() => undefined);
    logger.error("hiring_offer_send_failed", {
      offerId: offer.id,
      message: e instanceof Error ? e.message : String(e),
    });
    throw unprocessable(
      "The offer email could not be sent, so nothing has been sent to the candidate. Try again.",
      "email_failed",
    );
  }

  await prisma.$transaction([
    prisma.hiringOffer.update({
      where: { id: offer.id },
      data: { status: "sent", sentAt: new Date() },
    }),
    prisma.hiringApplicationEvent.create({
      data: {
        applicationId: offer.application.id,
        type: "offer_sent",
        actorId: access.userId,
        payload: { offerId: offer.id, to: offer.application.candidate.email },
      },
    }),
  ]);

  await recordHiringAudit({
    actorId: access.userId,
    action: "offer.sent",
    entityType: "HiringOffer",
    entityId: offer.id,
    after: { to: offer.application.candidate.email, expiresAt: offer.expiresAt },
  });

  return NextResponse.json({ ok: true });
});
