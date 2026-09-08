import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, forbidden } from "@/lib/http-error";
import { getHiringAccess } from "@/lib/hiring/access";
import { can, canScoreJob } from "@/lib/hiring/rbac";
import { SCORECARD_VERDICTS } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

const schema = z.object({
  ratings: z.record(z.number().int().min(1).max(4)).optional(),
  overall: z.enum(SCORECARD_VERDICTS),
  notesMd: z.string().trim().max(10_000).nullable().optional(),
});

/**
 * POST /api/hiring/interviews/[id]/scorecard — submit or update YOUR scorecard.
 *
 * Anyone on the panel can file one, and so can whoever is named as the req's
 * hiring manager, whatever their base role — §6 makes that derived rather than
 * a role you have to be granted. One scorecard per reviewer per interview; a
 * second submission replaces yours and never someone else's.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { access } = await getHiringAccess();
  if (!access) throw forbidden();
  const body = schema.parse(await req.json());

  const interview = await prisma.hiringInterview.findUnique({
    where: { id: params.id },
    include: {
      application: { select: { id: true, job: { select: { ownerId: true, hiringManagerId: true } } } },
    },
  });
  if (!interview) throw notFound("That interview no longer exists.");

  const onPanel = interview.panel.includes(access.userId);
  if (!onPanel && !canScoreJob(access, interview.application.job) && !can(access, "interview:manage")) {
    throw forbidden("Only the panel and the requisition's hiring manager can score this interview.");
  }

  const scorecard = await prisma.$transaction(async (tx) => {
    const saved = await tx.hiringScorecard.upsert({
      where: { interviewId_reviewerId: { interviewId: params.id, reviewerId: access.userId } },
      create: {
        interviewId: params.id,
        reviewerId: access.userId,
        ratings: (body.ratings ?? {}) as never,
        overall: body.overall,
        notesMd: body.notesMd ?? null,
      },
      update: {
        ratings: (body.ratings ?? {}) as never,
        overall: body.overall,
        notesMd: body.notesMd ?? null,
        submittedAt: new Date(),
      },
    });

    await tx.hiringApplicationEvent.create({
      data: {
        applicationId: interview.application.id,
        type: "scorecard_submitted",
        actorId: access.userId,
        payload: { interviewId: params.id, overall: body.overall },
      },
    });

    // An interview being scored is an interview that happened.
    if (interview.status === "scheduled") {
      await tx.hiringInterview.update({ where: { id: params.id }, data: { status: "completed" } });
    }

    return saved;
  });

  return NextResponse.json({ scorecard }, { status: 201 });
});
