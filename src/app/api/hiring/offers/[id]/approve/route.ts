import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, badRequest } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";

export const dynamic = "force-dynamic";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(300).optional(),
});

/**
 * POST /api/hiring/offers/[id]/approve
 *
 * Approving is a MANAGEMENT act, not a recruiter one, so it needs team:manage
 * rather than offer:manage — otherwise whoever wrote the over-band offer could
 * approve their own.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("team:manage");
  const body = schema.parse(await req.json());

  const offer = await prisma.hiringOffer.findFirst({ where: { id: params.id, deletedAt: null } });
  if (!offer) throw notFound("That offer no longer exists.");
  if (offer.status !== "pending_approval") {
    throw badRequest("That offer is not waiting for approval.", "not_pending");
  }
  if (offer.createdById === access.userId) {
    throw badRequest(
      "You wrote this offer, so you cannot approve it. Ask another Owner or HR Manager.",
      "self_approval",
    );
  }

  const updated = await prisma.hiringOffer.update({
    where: { id: params.id },
    data:
      body.decision === "approve"
        ? { status: "draft", approvedById: access.userId, approvedAt: new Date() }
        : { status: "withdrawn", approvedById: null, approvedAt: null },
  });

  await recordHiringAudit({
    actorId: access.userId,
    action: body.decision === "approve" ? "offer.approved" : "offer.approval_rejected",
    entityType: "HiringOffer",
    entityId: params.id,
    after: { status: updated.status, note: body.note ?? null },
  });

  return NextResponse.json({ status: updated.status });
});
