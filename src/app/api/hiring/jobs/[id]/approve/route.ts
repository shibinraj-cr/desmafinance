import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, badRequest } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { publishJob } from "@/lib/hiring/jobs";

export const dynamic = "force-dynamic";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(300).optional(),
});

/**
 * POST /api/hiring/jobs/[id]/approve — approval routing (§3.1 step 5).
 *
 * Approving a req that is already waiting publishes it in the same action:
 * the approval WAS the remaining gate, and leaving it approved-but-not-live
 * would just be a second thing to remember.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  // Approving a requisition is a management act, not a recruiter one.
  const access = await requireHiring("team:manage");
  const body = schema.parse(await req.json());

  const job = await prisma.hiringJob.findFirst({
    where: { id: params.id, deletedAt: null },
  });
  if (!job) throw notFound("That requisition no longer exists.");
  if (job.status !== "pending_approval") {
    throw badRequest("That requisition is not waiting for approval.", "not_pending");
  }

  if (body.decision === "reject") {
    await prisma.hiringJob.update({
      where: { id: params.id },
      data: { status: "draft", approvedById: null, approvedAt: null },
    });
    await recordHiringAudit({
      actorId: access.userId,
      action: "job.approval_rejected",
      entityType: "HiringJob",
      entityId: params.id,
      after: { note: body.note ?? null },
    });
    return NextResponse.json({ status: "draft" });
  }

  await prisma.hiringJob.update({
    where: { id: params.id },
    data: { approvedById: access.userId, approvedAt: new Date() },
  });
  const outcome = await publishJob(params.id);

  await recordHiringAudit({
    actorId: access.userId,
    action: "job.approved",
    entityType: "HiringJob",
    entityId: params.id,
    after: { status: outcome.status, note: body.note ?? null },
  });

  return NextResponse.json({ outcome });
});
