import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import {
  buildCandidateWhere,
  candidateOrderBy,
  applicationListInclude,
  serializeApplicationRow,
  sortRows,
} from "@/lib/hiring/candidates";
import { submitApplication } from "@/lib/hiring/apply";
import { CANDIDATE_SOURCES } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (req: Request) => {
  await requireHiring("candidate:read");
  const url = new URL(req.url);
  const minScoreRaw = url.searchParams.get("minScore");
  const sort = url.searchParams.get("sort");

  const rows = await prisma.hiringApplication.findMany({
    where: buildCandidateWhere({
      status: url.searchParams.get("status"),
      jobId: url.searchParams.get("jobId"),
      stageId: url.searchParams.get("stageId"),
      ownerId: url.searchParams.get("ownerId"),
      minScore: minScoreRaw ? Number(minScoreRaw) : null,
      source: url.searchParams.get("source"),
      q: url.searchParams.get("q"),
    }),
    include: applicationListInclude,
    orderBy: candidateOrderBy(sort),
    take: 500,
  });

  return NextResponse.json({
    applications: sortRows(rows.map((r) => serializeApplicationRow(r)), sort),
  });
});

const addSchema = z.object({
  jobId: z.string().min(1),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  currentTitle: z.string().trim().max(120).optional(),
  currentEmployer: z.string().trim().max(120).optional(),
  locationText: z.string().trim().max(160).optional(),
  linkedinUrl: z.string().trim().max(500).optional(),
  portfolioUrl: z.string().trim().max(500).optional(),
  noticePeriodDays: z.number().int().min(0).max(365).nullable().optional(),
  expectedCtcLakh: z.number().min(0).max(999).nullable().optional(),
  source: z.enum(CANDIDATE_SOURCES).default("manual"),
  sourceDetail: z.string().trim().max(160).optional(),
});

// POST /api/hiring/candidates — "Add candidate" on the rail. Goes through the
// same intake as a public application, so dedupe and the created event are the
// same code either way.
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("candidate:write");
  const body = addSchema.parse(await req.json());

  const result = await submitApplication({
    ...body,
    email: body.email ?? null,
    phone: body.phone ?? null,
    ownerId: access.userId,
    createdById: access.userId,
    consent: false,
  });

  return NextResponse.json({ ...result }, { status: 201 });
});
