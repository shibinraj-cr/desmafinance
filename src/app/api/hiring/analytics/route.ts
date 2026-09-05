import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import {
  REPORT_DIMENSIONS,
  REPORT_MEASURES,
  DIMENSION_LABELS,
  MEASURE_LABELS,
  reportToCsv,
  type ReportDimension,
  type ReportMeasure,
} from "@/lib/hiring/analytics";
import { CANDIDATE_SOURCE_LABELS, type CandidateSource } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

const schema = z.object({
  dimension: z.enum(REPORT_DIMENSIONS),
  measures: z.array(z.enum(REPORT_MEASURES)).min(1).max(4),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

/**
 * POST /api/hiring/analytics — the custom report builder.
 *
 * One query per measure rather than one clever join: these are counts over a
 * few thousand rows, and a readable aggregate that anybody can check against
 * the funnel beats a fast one nobody can reason about.
 */
export const POST = withApiHandler(async (req: Request) => {
  await requireHiring("analytics:read");
  const body = schema.parse(await req.json());

  const range =
    body.from || body.to
      ? {
          gte: body.from ? new Date(body.from) : undefined,
          lte: body.to ? new Date(body.to) : undefined,
        }
      : undefined;

  const applications = await prisma.hiringApplication.findMany({
    where: { deletedAt: null, ...(range ? { appliedAt: range } : {}) },
    select: {
      id: true,
      status: true,
      aiScore: true,
      candidate: { select: { source: true, owner: { select: { username: true } } } },
      job: { select: { id: true, title: true, department: true } },
      stage: { select: { name: true } },
      offers: { select: { sentAt: true } },
    },
    take: 5000,
  });

  const buckets = new Map<string, { label: string; rows: typeof applications }>();
  for (const app of applications) {
    const { key, label } = bucketFor(body.dimension, app);
    if (!buckets.has(key)) buckets.set(key, { label, rows: [] });
    buckets.get(key)!.rows.push(app);
  }

  const rows = [...buckets.entries()]
    .map(([key, { label, rows: group }]) => {
      const scored = group.filter((g) => g.aiScore != null);
      const record: Record<string, string | number | null> = { key, label };
      for (const measure of body.measures) {
        record[measure] =
          measure === "applications"
            ? group.length
            : measure === "hires"
              ? group.filter((g) => g.status === "hired").length
              : measure === "offers"
                ? group.filter((g) => g.offers.some((o) => o.sentAt)).length
                : scored.length === 0
                  ? null
                  : Math.round(scored.reduce((a, g) => a + (g.aiScore ?? 0), 0) / scored.length);
      }
      return record;
    })
    .sort((a, b) => Number(b[body.measures[0]!] ?? 0) - Number(a[body.measures[0]!] ?? 0));

  if (body.format === "csv") {
    const headers = [DIMENSION_LABELS[body.dimension], ...body.measures.map((m) => MEASURE_LABELS[m])];
    const csv = reportToCsv(
      headers,
      rows.map((r) => [String(r.label), ...body.measures.map((m) => r[m] as number | null)]),
    );
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv;charset=utf-8",
        "content-disposition": `attachment; filename="hiring-report-${body.dimension}.csv"`,
      },
    });
  }

  return NextResponse.json({
    dimension: body.dimension,
    dimensionLabel: DIMENSION_LABELS[body.dimension],
    measures: body.measures,
    measureLabels: body.measures.map((m) => MEASURE_LABELS[m as ReportMeasure]),
    rows,
    total: applications.length,
  });
});

type AppRow = {
  candidate: { source: string; owner: { username: string } | null };
  job: { id: string; title: string; department: string };
  stage: { name: string } | null;
};

function bucketFor(dimension: ReportDimension, app: AppRow): { key: string; label: string } {
  switch (dimension) {
    case "source":
      return {
        key: app.candidate.source,
        label: CANDIDATE_SOURCE_LABELS[app.candidate.source as CandidateSource] ?? app.candidate.source,
      };
    case "department":
      return { key: app.job.department, label: app.job.department };
    case "job":
      return { key: app.job.id, label: app.job.title };
    case "stage":
      return { key: app.stage?.name ?? "none", label: app.stage?.name ?? "No stage" };
    case "owner":
      // "Unassigned" is a real and important bucket, not a gap in the data.
      return {
        key: app.candidate.owner?.username ?? "unassigned",
        label: app.candidate.owner?.username ?? "Unassigned",
      };
  }
}
