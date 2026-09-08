import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { createJobSchema } from "@/lib/hiring/job-schemas";
import {
  buildJobWhere,
  jobListInclude,
  serializeJobRow,
  createJob,
  publishJob,
  computeJobKpis,
} from "@/lib/hiring/jobs";

export const dynamic = "force-dynamic";

// GET /api/hiring/jobs?tab=&department=&ownerId=&locationId=&q=
export const GET = withApiHandler(async (req: Request) => {
  await requireHiring("job:read");
  const url = new URL(req.url);
  const where = buildJobWhere({
    tab: url.searchParams.get("tab"),
    department: url.searchParams.get("department"),
    ownerId: url.searchParams.get("ownerId"),
    locationId: url.searchParams.get("locationId"),
    q: url.searchParams.get("q"),
  });

  const [rows, kpis] = await Promise.all([
    prisma.hiringJob.findMany({
      where,
      include: jobListInclude,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 500,
    }),
    computeJobKpis(),
  ]);

  return NextResponse.json({ jobs: rows.map(serializeJobRow), kpis });
});

// POST /api/hiring/jobs — the wizard's save, and Quick add.
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("job:write");
  const body = createJobSchema.parse(await req.json());

  const job = await createJob({ ...body, createdById: access.userId });

  await recordHiringAudit({
    actorId: access.userId,
    action: "job.create",
    entityType: "HiringJob",
    entityId: job.id,
    after: { title: job.title, slug: job.slug, status: job.status },
  });

  // "Publish job" on the wizard's review step. A job that is not ready comes
  // back as a draft WITH its blockers, rather than silently half-published.
  if (body.publish) {
    const outcome = await publishJob(job.id);
    if (outcome.published || outcome.status === "pending_approval") {
      await recordHiringAudit({
        actorId: access.userId,
        action: outcome.published ? "job.publish" : "job.route_for_approval",
        entityType: "HiringJob",
        entityId: job.id,
        after: { status: outcome.status },
      });
    }
    return NextResponse.json({ job: serializeJobRow(job), outcome }, { status: 201 });
  }

  return NextResponse.json({ job: serializeJobRow(job) }, { status: 201 });
});
