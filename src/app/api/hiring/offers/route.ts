import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { createOffer, offerInclude, serializeOffer } from "@/lib/hiring/offers";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (req: Request) => {
  await requireHiring("offer:manage");
  const status = new URL(req.url).searchParams.get("status");
  const rows = await prisma.hiringOffer.findMany({
    where: { deletedAt: null, ...(status ? { status } : {}) },
    include: offerInclude,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return NextResponse.json({ offers: rows.map(serializeOffer) });
});

const schema = z.object({
  applicationId: z.string().min(1),
  jobTitle: z.string().trim().max(140).optional(),
  department: z.string().trim().max(80).nullable().optional(),
  locationId: z.string().nullable().optional(),
  startDate: z.string().datetime().nullable().optional(),
  baseLakh: z.number().min(0).max(9999),
  variableLakh: z.number().min(0).max(9999).nullable().optional(),
  joiningBonusLakh: z.number().min(0).max(9999).nullable().optional(),
  otherTermsMd: z.string().max(10_000).nullable().optional(),
  probationMonths: z.number().int().min(0).max(36).nullable().optional(),
  noticePeriodDays: z.number().int().min(0).max(365).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("offer:manage");
  const body = schema.parse(await req.json());
  const offer = await createOffer({ ...body, createdById: access.userId });

  await recordHiringAudit({
    actorId: access.userId,
    action: "offer.create",
    entityType: "HiringOffer",
    entityId: offer.id,
    after: { baseLakh: Number(offer.baseLakh), status: offer.status },
  });

  return NextResponse.json({ offer: serializeOffer(offer) }, { status: 201 });
});
