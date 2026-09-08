import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, forbidden } from "@/lib/http-error";
import { requireHiring, getHiringAccess } from "@/lib/hiring/access";
import { can, canReviewJob } from "@/lib/hiring/rbac";
import { applicationListInclude, serializeApplicationRow } from "@/lib/hiring/candidates";

export const dynamic = "force-dynamic";

/** GET — everything the candidate drawer shows for one application. */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const { access } = await getHiringAccess();
  if (!access) throw forbidden();

  const app = await prisma.hiringApplication.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      ...applicationListInclude,
      job: {
        select: {
          id: true,
          title: true,
          department: true,
          ownerId: true,
          hiringManagerId: true,
          mustHaves: true,
          niceToHaves: true,
          stages: { orderBy: { position: "asc" } },
          questions: { orderBy: { position: "asc" }, select: { id: true, prompt: true, answerType: true } },
        },
      },
      candidate: {
        select: {
          id: true, fullName: true, email: true, phone: true, whatsappOptIn: true,
          currentTitle: true, currentEmployer: true, locationText: true,
          totalExperienceYears: true, noticePeriodDays: true, currentCtcLakh: true,
          expectedCtcLakh: true, resumeUrl: true, portfolioUrl: true, linkedinUrl: true,
          source: true, tags: true, humanEditedFields: true, consentAt: true,
          owner: { select: { id: true, username: true } },
        },
      },
      events: { orderBy: { occurredAt: "desc" }, take: 200, include: { actor: { select: { username: true } } } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { username: true } } } },
      interviews: {
        orderBy: { scheduledAt: "desc" },
        include: { scorecards: { include: { reviewer: { select: { username: true } } } } },
      },
      offers: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!app) throw notFound("That application no longer exists.");

  // A hiring manager named on the req may read its candidates even without the
  // general candidate:read key.
  if (!can(access, "candidate:read") && !canReviewJob(access, app.job)) throw forbidden();

  // Partner-hidden and private notes never leave the server for someone who
  // should not see them.
  const visibleNotes = app.notes.filter(
    (n) => n.visibility === "team" || n.authorId === access.userId,
  );

  return NextResponse.json({
    application: serializeApplicationRow(app),
    candidate: {
      ...app.candidate,
      totalExperienceYears: app.candidate.totalExperienceYears == null ? null : Number(app.candidate.totalExperienceYears),
      currentCtcLakh: app.candidate.currentCtcLakh == null ? null : Number(app.candidate.currentCtcLakh),
      expectedCtcLakh: app.candidate.expectedCtcLakh == null ? null : Number(app.candidate.expectedCtcLakh),
      consentAt: app.candidate.consentAt?.toISOString() ?? null,
    },
    job: app.job,
    answers: app.answers ?? {},
    aiScoreBreakdown: app.aiScoreBreakdown ?? null,
    events: app.events.map((e) => ({
      id: e.id,
      type: e.type,
      fromStage: e.fromStage,
      toStage: e.toStage,
      actorName: e.actor?.username ?? null,
      payload: e.payload,
      occurredAt: e.occurredAt.toISOString(),
    })),
    notes: visibleNotes.map((n) => ({
      id: n.id,
      bodyMd: n.bodyMd,
      visibility: n.visibility,
      authorName: n.author?.username ?? "System",
      createdAt: n.createdAt.toISOString(),
    })),
    interviews: app.interviews.map((i) => ({
      id: i.id,
      kind: i.kind,
      scheduledAt: i.scheduledAt.toISOString(),
      durationMin: i.durationMin,
      mode: i.mode,
      status: i.status,
      panel: i.panel,
      scorecards: i.scorecards.map((s) => ({
        id: s.id,
        reviewerName: s.reviewer.username,
        overall: s.overall,
        notesMd: s.notesMd,
        submittedAt: s.submittedAt.toISOString(),
      })),
    })),
    offers: app.offers.map((o) => ({
      id: o.id,
      status: o.status,
      baseLakh: Number(o.baseLakh),
      startDate: o.startDate?.toISOString() ?? null,
      expiresAt: o.expiresAt?.toISOString() ?? null,
    })),
  });
});

const patchSchema = z.object({
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  needsAttention: z.boolean().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("candidate:write");
  const body = patchSchema.parse(await req.json());

  const app = await prisma.hiringApplication.findFirst({
    where: { id: params.id, deletedAt: null },
  });
  if (!app) throw notFound("That application no longer exists.");

  const updated = await prisma.hiringApplication.update({
    where: { id: params.id },
    data: {
      nextFollowUpAt:
        body.nextFollowUpAt === undefined
          ? undefined
          : body.nextFollowUpAt
            ? new Date(body.nextFollowUpAt)
            : null,
      needsAttention: body.needsAttention,
    },
  });

  return NextResponse.json({ ok: true, nextFollowUpAt: updated.nextFollowUpAt });
});
