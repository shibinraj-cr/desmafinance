import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { TALENT_POOL_STATES } from "@/lib/hiring/constants";
import { recordPoolEvent } from "@/lib/hiring/talent-pool";

export const dynamic = "force-dynamic";

const schema = z.object({
  state: z.enum(TALENT_POOL_STATES).optional(),
  interestAreas: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  notesMd: z.string().trim().max(4000).nullable().optional(),
  nextTouchAt: z.string().datetime().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  /** Set when the move is a "touch" — records that someone reached out. */
  touched: z.boolean().optional(),
  /** What the recruiter wrote about this change. Kept on the timeline. */
  note: z.string().trim().max(4000).optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("candidate:write");
  const body = schema.parse(await req.json());

  const existing = await prisma.hiringTalentPool.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound("That prospect is no longer in the pool.");

  const prospect = await prisma.hiringTalentPool.update({
    where: { id: params.id },
    data: {
      state: body.state,
      interestAreas: body.interestAreas,
      notesMd: body.notesMd,
      ownerId: body.ownerId,
      nextTouchAt:
        body.nextTouchAt === undefined ? undefined : body.nextTouchAt ? new Date(body.nextTouchAt) : null,
      ...(body.touched ? { lastTouchAt: new Date() } : {}),
    },
  });

  // One entry per thing that actually happened, so the timeline reads as a
  // sequence of events rather than one lumped "updated".
  const movedStage = body.state !== undefined && body.state !== existing.state;
  if (movedStage) {
    await recordPoolEvent({
      candidateId: existing.candidateId,
      type: "stage_changed",
      fromState: existing.state,
      toState: body.state,
      note: body.note ?? null,
      actorId: access.userId,
    });
  }
  if (body.touched) {
    await recordPoolEvent({
      candidateId: existing.candidateId,
      type: "touched",
      // A note already spent on the stage change is not repeated here.
      note: movedStage ? null : (body.note ?? null),
      actorId: access.userId,
    });
  }
  if (body.note && !movedStage && !body.touched) {
    await recordPoolEvent({
      candidateId: existing.candidateId,
      type: "note",
      note: body.note,
      actorId: access.userId,
    });
  }
  if (body.ownerId !== undefined && body.ownerId !== existing.ownerId) {
    await recordPoolEvent({
      candidateId: existing.candidateId,
      type: "owner_changed",
      actorId: access.userId,
    });
  }

  return NextResponse.json({ prospect });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("candidate:write");
  // Only the pool membership goes; the person stays, with their history — the
  // events hang off the candidate, so nothing here cascades them away.
  const existing = await prisma.hiringTalentPool.findUnique({
    where: { id: params.id },
    select: { candidateId: true, state: true },
  });
  await prisma.hiringTalentPool.delete({ where: { id: params.id } }).catch(() => undefined);
  if (existing) {
    await recordPoolEvent({
      candidateId: existing.candidateId,
      type: "removed",
      fromState: existing.state,
      actorId: access.userId,
    });
  }
  return NextResponse.json({ ok: true });
});
