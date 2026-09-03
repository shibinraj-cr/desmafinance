import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, unprocessable } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { siteBaseUrl } from "@/lib/site-url";
import { getEmailConfig, sendEmail } from "@/lib/mailer";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit, clientIp } from "@/lib/hiring/audit";
import { createMagicLink } from "@/lib/hiring/partner-scope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/hiring/partners/[id]/invite — email a magic link.
 *
 * No password is ever set for a partner: they are not Desgro users, and giving
 * an external agency a login into an ERP would be a much larger surface than
 * they need. A short-lived, single-use link that exchanges for a 7-day portal
 * session is the whole authentication story.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("sourcing:manage");

  const partner = await prisma.hiringPartner.findUnique({ where: { id: params.id } });
  if (!partner) throw notFound("That partner no longer exists.");

  const cfg = await getEmailConfig();
  if (!cfg) {
    throw unprocessable(
      "Email is not configured, so the invite cannot be sent. Set it up on CRM → Settings → Integrations first.",
      "email_unconfigured",
    );
  }

  const raw = await createMagicLink(partner.id, clientIp());
  const url = `${siteBaseUrl(req).replace(/\/$/, "")}/partners/login/${raw}`;

  try {
    await sendEmail(cfg, {
      to: partner.contactEmail,
      subject: "Your DESMA International sourcing portal link",
      text:
        `Hello${partner.primaryContactName ? ` ${partner.primaryContactName}` : ""},\n\n` +
        `Here is your link to the DESMA International sourcing portal:\n${url}\n\n` +
        `The link works once and expires in 30 minutes; it signs you in for a week. ` +
        `In the portal you will see the roles we have opened to you and the candidates you have submitted.\n\n` +
        `— DESMA International`,
    });
  } catch (e) {
    logger.error("hiring_partner_invite_failed", {
      partnerId: partner.id,
      message: e instanceof Error ? e.message : String(e),
    });
    throw unprocessable("The invite email could not be sent. Try again.", "email_failed");
  }

  await prisma.hiringPartner.update({
    where: { id: partner.id },
    data: {
      invitedAt: new Date(),
      // Inviting an agency that has never signed in moves it to "trial"; an
      // already-active partner stays active.
      status: partner.status === "invited" ? "trial" : partner.status,
    },
  });

  await recordHiringAudit({
    actorId: access.userId,
    action: "partner.invited",
    entityType: "HiringPartner",
    entityId: partner.id,
    after: { to: partner.contactEmail },
  });

  return NextResponse.json({ ok: true });
});
