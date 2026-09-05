import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { moveMany } from "@/lib/hiring/pipeline";

export const dynamic = "force-dynamic";

const schema = z.object({
  applicationIds: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["move", "assign", "follow_up"]),
  toStageId: z.string().optional(),
  ownerId: z.string().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Bulk actions from the pipeline's multi-select.
 *
 * A per-item failure is reported, not thrown: with 40 cards selected, failing
 * the whole batch because one was already in the target stage helps nobody.
 */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("candidate:move");
  const body = schema.parse(await req.json());

  if (body.action === "move") {
    if (!body.toStageId) {
      return NextResponse.json({ error: "bad_request", message: "Pick a stage to move to." }, { status: 400 });
    }
    const result = await moveMany({
      applicationIds: body.applicationIds,
      toStageId: body.toStageId,
      actorId: access.userId,
      reason: body.reason ?? null,
    });
    return NextResponse.json(result);
  }

  if (body.action === "assign") {
    // Ownership lives on the PERSON, not the application: whoever owns the
    // candidate owns them across every role they applied to.
    const apps = await prisma.hiringApplication.findMany({
      where: { id: { in: body.applicationIds }, deletedAt: null },
      select: { candidateId: true },
    });
    const { count } = await prisma.hiringCandidate.updateMany({
      where: { id: { in: apps.map((a) => a.candidateId) } },
      data: { ownerId: body.ownerId ?? null },
    });
    return NextResponse.json({ moved: count, failures: [] });
  }

  const { count } = await prisma.hiringApplication.updateMany({
    where: { id: { in: body.applicationIds }, deletedAt: null },
    data: { nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null },
  });
  return NextResponse.json({ moved: count, failures: [] });
});
