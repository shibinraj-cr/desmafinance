import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { forbidden, notFound } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { KpiReviewSchema } from "@/lib/sop/schemas";
import { canRecordKpiReview, canViewSop } from "@/lib/sop/rbac";
import { recordSopAudit } from "@/lib/sop/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { kpiId: string } };

/** GET — this KPI's recorded results, newest period first. */
export const GET = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const kpi = await loadKpi(params.kpiId);
  if (!canViewSop(access, kpi.version.sop)) throw forbidden();

  const reviews = await prisma.sopKpiReview.findMany({
    where: { kpiId: kpi.id },
    orderBy: { periodEnd: "desc" },
    include: { reviewedBy: { select: { username: true } } },
  });
  return NextResponse.json({ reviews });
});

/**
 * POST — record a KPI result for a period (§9).
 *
 * Upserted on `(kpi, periodStart, periodEnd)`: correcting last month's number
 * should overwrite last month's row, not append a second one that makes the
 * trend chart show the same period twice.
 *
 * `actualNumeric` is populated only when the entry parses as a number, so a
 * result of "18h" is still recorded truthfully and simply has no numeric form.
 */
export const POST = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const kpi = await loadKpi(params.kpiId);
  if (!canRecordKpiReview(access, kpi.version.sop, kpi)) throw forbidden();

  const d = KpiReviewSchema.parse(await req.json().catch(() => null));
  const numeric = parseNumeric(d.actual);

  const review = await prisma.$transaction(async (tx) => {
    const row = await tx.sopKpiReview.upsert({
      where: {
        kpiId_periodStart_periodEnd: {
          kpiId: kpi.id,
          periodStart: d.periodStart,
          periodEnd: d.periodEnd,
        },
      },
      create: {
        kpiId: kpi.id,
        versionId: kpi.versionId,
        sopId: kpi.version.sopId,
        periodStart: d.periodStart,
        periodEnd: d.periodEnd,
        actual: d.actual,
        actualNumeric: numeric,
        status: d.status,
        notes: d.notes ?? null,
        reviewedById: access.userId,
        reviewedAt: new Date(),
      },
      update: {
        actual: d.actual,
        actualNumeric: numeric,
        status: d.status,
        notes: d.notes ?? null,
        reviewedById: access.userId,
        reviewedAt: new Date(),
      },
    });

    // Keep the KPI's denormalised "latest" in step, but only when this review
    // IS the latest — correcting an old period must not overwrite the newest
    // number on the KPI card.
    const newest = await tx.sopKpiReview.findFirst({
      where: { kpiId: kpi.id },
      orderBy: { periodEnd: "desc" },
      select: { id: true, actual: true, status: true, reviewedAt: true },
    });
    if (newest) {
      await tx.sopKpi.update({
        where: { id: kpi.id },
        data: {
          latestActual: newest.actual,
          latestStatus: newest.status,
          latestReviewedAt: newest.reviewedAt,
        },
      });
    }
    return row;
  });

  await recordSopAudit({
    sopId: kpi.version.sopId,
    versionId: kpi.versionId,
    versionLabel: kpi.version.versionLabel,
    userId: access.userId,
    action: "KPI_REVIEW_RECORDED",
    field: kpi.name,
    newValue: `${d.actual} (${d.status})`,
    metadata: {
      periodStart: d.periodStart.toISOString().slice(0, 10),
      periodEnd: d.periodEnd.toISOString().slice(0, 10),
    },
  });

  return NextResponse.json({ review }, { status: 201 });
});

async function loadKpi(kpiId: string) {
  const kpi = await prisma.sopKpi.findUnique({
    where: { id: kpiId },
    include: {
      version: {
        select: {
          id: true,
          sopId: true,
          versionLabel: true,
          sop: {
            select: {
              id: true,
              ownerEmployeeId: true,
              departmentId: true,
              confidentiality: true,
              createdById: true,
              isArchived: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });
  if (!kpi || kpi.version.sop.deletedAt) throw notFound("KPI not found.");
  return kpi;
}

/** "96%", "18.5", "< 24" → a number where one is unambiguous, else null. */
function parseNumeric(actual: string): number | null {
  const m = /^-?\d+(\.\d+)?/.exec(actual.trim());
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
