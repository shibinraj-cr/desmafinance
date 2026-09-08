import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { updateOffer, offerInclude, serializeOffer } from "@/lib/hiring/offers";

export const dynamic = "force-dynamic";

const schema = z.object({
  jobTitle: z.string().trim().max(140).optional(),
  department: z.string().trim().max(80).nullable().optional(),
  locationId: z.string().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  baseLakh: z.number().min(0).max(9999).optional(),
  variableLakh: z.number().min(0).max(9999).nullable().optional(),
  joiningBonusLakh: z.number().min(0).max(9999).nullable().optional(),
  otherTermsMd: z.string().max(10_000).nullable().optional(),
  probationMonths: z.number().int().min(0).max(36).nullable().optional(),
  noticePeriodDays: z.number().int().min(0).max(365).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("offer:manage");
  const offer = await prisma.hiringOffer.findFirst({
    where: { id: params.id, deletedAt: null },
    include: offerInclude,
  });
  if (!offer) throw notFound("That offer no longer exists.");
  return NextResponse.json({ offer: serializeOffer(offer) });
});

export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("offer:manage");
  const body = schema.parse(await req.json());
  const offer = await updateOffer(params.id, body);

  await recordHiringAudit({
    actorId: access.userId,
    action: "offer.update",
    entityType: "HiringOffer",
    entityId: offer.id,
    after: { baseLakh: Number(offer.baseLakh), status: offer.status },
  });

  return NextResponse.json({ offer: serializeOffer(offer) });
});
