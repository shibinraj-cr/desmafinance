import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, badRequest, forbidden } from "@/lib/http-error";
import { requireHiring, getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { patchJobSchema } from "@/lib/hiring/job-schemas";
import { jobListInclude, serializeJobRow } from "@/lib/hiring/jobs";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export const GET = withApiHandler(async (_req: Request, { params }: Ctx) => {
  await requireHiring("job:read");
  const job = await prisma.hiringJob.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      ...jobListInclude,
      stages: { orderBy: { position: "asc" } },
      rubrics: { orderBy: { position: "asc" } },
      questions: { orderBy: { position: "asc" } },
    },
  });
  if (!job) throw notFound("That requisition no longer exists.");
  return NextResponse.json({
    job: serializeJobRow(job),
    stages: job.stages,
    rubrics: job.rubrics,
    questions: job.questions,
  });
});

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireHiring("job:write");
  const body = patchJobSchema.parse(await req.json());

  const before = await prisma.hiringJob.findFirst({
    where: { id: params.id, deletedAt: null },
    include: { rubrics: true, questions: true, stages: true },
  });
  if (!before) throw notFound("That requisition no longer exists.");

  const min = body.compMinLakh ?? (before.compMinLakh == null ? null : Number(before.compMinLakh));
  const max = body.compMaxLakh ?? (before.compMaxLakh == null ? null : Number(before.compMaxLakh));
  if (min != null && max != null && min > max) {
    throw badRequest("The minimum of the comp band is above its maximum.", "bad_comp_band");
  }

  // Stage edits are a replace, not a merge: reordering and renaming is the
  // point, and analytics survive it because they read kind + position. Stages
  // that still hold applications are kept by id so no application is orphaned.
  const stageOps = body.stages
    ? await buildStageOps(params.id, before.stages, body.stages)
    : null;

  const job = await prisma.$transaction(async (tx) => {
    if (body.rubrics) {
      await tx.hiringJobRubric.deleteMany({ where: { jobId: params.id } });
      await tx.hiringJobRubric.createMany({
        data: body.rubrics.map((r, i) => ({
          jobId: params.id,
          criterion: r.criterion,
          description: r.description ?? null,
          weight: r.weight,
          position: i,
        })),
      });
    }
    if (body.questions) {
      await tx.hiringScreeningQuestion.deleteMany({ where: { jobId: params.id } });
      await tx.hiringScreeningQuestion.createMany({
        data: body.questions.map((q, i) => ({
          jobId: params.id,
          prompt: q.prompt,
          helperText: q.helperText ?? null,
          answerType: q.answerType,
          required: q.required,
          options: q.options ? (q.options as never) : undefined,
          position: i,
        })),
      });
    }
    if (stageOps) {
      // Park every survivor out of the way first: `position` is unique per job,
      // so renumbering in place would collide mid-flight.
      for (const s of stageOps.keep) {
        await tx.hiringJobStage.update({
          where: { id: s.id },
          data: { position: -1 - s.nextPosition },
        });
      }
      if (stageOps.remove.length) {
        await tx.hiringJobStage.deleteMany({ where: { id: { in: stageOps.remove } } });
      }
      for (const s of stageOps.keep) {
        await tx.hiringJobStage.update({
          where: { id: s.id },
          data: { name: s.name, kind: s.kind, slaDays: s.slaDays, position: s.nextPosition },
        });
      }
      for (const s of stageOps.create) {
        await tx.hiringJobStage.create({
          data: { jobId: params.id, name: s.name, kind: s.kind, slaDays: s.slaDays, position: s.nextPosition },
        });
      }
    }

    return tx.hiringJob.update({
      where: { id: params.id },
      data: {
        title: body.title,
        department: body.department,
        jobRoleId: body.jobRoleId,
        locationId: body.locationId,
        workType: body.workType,
        employmentType: body.employmentType,
        seniority: body.seniority,
        compMinLakh: body.compMinLakh,
        compMaxLakh: body.compMaxLakh,
        compVisible: body.compVisible,
        descriptionMd: body.descriptionMd,
        mustHaves: body.mustHaves,
        niceToHaves: body.niceToHaves,
        openings: body.openings,
        ownerId: body.ownerId,
        hiringManagerId: body.hiringManagerId,
        approvalRequired: body.approvalRequired,
        resumeMode: body.resumeMode,
        askScreeningQs: body.askScreeningQs,
        status: body.status,
      },
      include: jobListInclude,
    });
  });

  await recordHiringAudit({
    actorId: access.userId,
    action: "job.update",
    entityType: "HiringJob",
    entityId: job.id,
    before: { title: before.title, status: before.status },
    after: { title: job.title, status: job.status },
  });

  return NextResponse.json({ job: serializeJobRow(job) });
});

/**
 * Work out which stages survive a replace. A stage that still holds
 * applications is never deleted — dropping it would orphan live candidates —
 * so an attempt to remove one is refused with the count, rather than silently
 * moving people somewhere they were not put by a human.
 */
async function buildStageOps(
  jobId: string,
  existing: { id: string; name: string; kind: string; slaDays: number | null }[],
  next: { id?: string; name: string; kind: string; slaDays?: number | null }[],
) {
  const keptIds = new Set(next.map((s) => s.id).filter(Boolean) as string[]);
  const removing = existing.filter((s) => !keptIds.has(s.id)).map((s) => s.id);

  if (removing.length) {
    const holding = await prisma.hiringApplication.groupBy({
      by: ["stageId"],
      where: { jobId, stageId: { in: removing }, deletedAt: null },
      _count: { _all: true },
    });
    const blocked = holding.filter((h) => h._count._all > 0);
    if (blocked.length) {
      const names = blocked
        .map((b) => existing.find((e) => e.id === b.stageId)?.name ?? "a stage")
        .join(", ");
      throw badRequest(
        `Move the candidates out of ${names} before removing it — ` +
          `${blocked.reduce((s, b) => s + b._count._all, 0)} application(s) are still there.`,
        "stage_in_use",
      );
    }
  }

  return {
    keep: next
      .map((s, i) => ({ ...s, nextPosition: i }))
      .filter((s): s is typeof s & { id: string } => !!s.id)
      .map((s) => ({ id: s.id, name: s.name, kind: s.kind, slaDays: s.slaDays ?? null, nextPosition: s.nextPosition })),
    create: next
      .map((s, i) => ({ ...s, nextPosition: i }))
      .filter((s) => !s.id)
      .map((s) => ({ name: s.name, kind: s.kind, slaDays: s.slaDays ?? null, nextPosition: s.nextPosition })),
    remove: removing,
  };
}

const deleteSchema = z.object({
  /** Hard delete only: the exact job title, typed by a human. */
  confirmTitle: z.string().optional(),
  hard: z.boolean().optional(),
});

/**
 * Soft delete by default. A hard delete destroys the pipeline history the
 * funnel numbers are computed from, so it is owner-only, needs the title typed
 * back, and is audited.
 */
export const DELETE = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireHiring("job:write");
  const body = deleteSchema.parse(await req.json().catch(() => ({})));

  const job = await prisma.hiringJob.findUnique({ where: { id: params.id } });
  if (!job) throw notFound("That requisition no longer exists.");

  if (body.hard) {
    const { access: full } = await getHiringAccess();
    if (full?.baseRole !== "owner") {
      throw forbidden("Only a hiring Owner can permanently delete a requisition.");
    }
    if (body.confirmTitle?.trim() !== job.title) {
      throw badRequest(
        "Type the requisition's exact title to confirm a permanent delete.",
        "confirm_mismatch",
      );
    }
    await prisma.hiringJob.delete({ where: { id: params.id } });
    await recordHiringAudit({
      actorId: access.userId,
      action: "job.hard_delete",
      entityType: "HiringJob",
      entityId: params.id,
      before: { title: job.title, slug: job.slug, status: job.status },
    });
    return NextResponse.json({ ok: true, hard: true });
  }

  await prisma.hiringJob.update({
    where: { id: params.id },
    data: { deletedAt: new Date(), status: "closed", closedAt: job.closedAt ?? new Date() },
  });
  await recordHiringAudit({
    actorId: access.userId,
    action: "job.delete",
    entityType: "HiringJob",
    entityId: params.id,
    before: { status: job.status },
  });
  return NextResponse.json({ ok: true, hard: false });
});
