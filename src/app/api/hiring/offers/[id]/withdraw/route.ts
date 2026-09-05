import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, conflict } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";

export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().trim().max(300).optional() });

export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("offer:manage");
  const body = schema.parse(await req.json().catch(() => ({})));

  const offer = await prisma.hiringOffer.findFirst({ where: { id: params.id, deletedAt: null } });
  if (!offer) throw notFound("That offer no longer exists.");
  if (offer.status === "accepted") {
    throw conflict("That offer has been accepted. Withdrawing it is a conversation, not a button.", "already_accepted");
  }

  await prisma.$transaction([
    prisma.hiringOffer.update({
      where: { id: params.id },
      data: { status: "withdrawn", respondedAt: new Date() },
    }),
    // Every outstanding signing link for this offer dies with it.
    prisma.hiringOfferEnvelope.updateMany({
      where: { offerId: params.id, signedAt: null },
      data: { tokenExpiresAt: new Date() },
    }),
  ]);

  await recordHiringAudit({
    actorId: access.userId,
    action: "offer.withdrawn",
    entityType: "HiringOffer",
    entityId: params.id,
    after: { reason: body.reason ?? null },
  });

  return NextResponse.json({ ok: true });
});
