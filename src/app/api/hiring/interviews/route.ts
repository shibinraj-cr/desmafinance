import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound, badRequest } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { interviewInclude, serializeInterview } from "@/lib/hiring/interviews";
import { INTERVIEW_KINDS } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (req: Request) => {
  await requireHiring("interview:manage");
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const rows = await prisma.hiringInterview.findMany({
    where: status ? { status } : {},
    include: interviewInclude,
    orderBy: { scheduledAt: "asc" },
    take: 500,
  });
  return NextResponse.json({ interviews: rows.map((r) => serializeInterview(r)) });
});

const schema = z.object({
  applicationId: z.string().min(1),
  templateId: z.string().nullable().optional(),
  kind: z.enum(INTERVIEW_KINDS),
  scheduledAt: z.string().datetime(),
  durationMin: z.number().int().min(5).max(480).default(30),
  mode: z.enum(["in_person", "video", "phone"]).default("video"),
  locationOrLink: z.string().trim().max(500).nullable().optional(),
  panel: z.array(z.string().min(1)).max(10).default([]),
});

// POST /api/hiring/interviews — book an interview.
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("interview:manage");
  const body = schema.parse(await req.json());

  const app = await prisma.hiringApplication.findFirst({
    where: { id: body.applicationId, deletedAt: null },
    select: { id: true, status: true, candidate: { select: { fullName: true } } },
  });
  if (!app) throw notFound("That application no longer exists.");
  if (app.status === "rejected" || app.status === "withdrawn") {
    throw badRequest(
      "That candidate is not in the pipeline any more — move them back before booking.",
      "not_active",
    );
  }

  const scheduledAt = new Date(body.scheduledAt);

  const interview = await prisma.$transaction(async (tx) => {
    const created = await tx.hiringInterview.create({
      data: {
        applicationId: body.applicationId,
        templateId: body.templateId ?? null,
        kind: body.kind,
        scheduledAt,
        durationMin: body.durationMin,
        mode: body.mode,
        locationOrLink: body.locationOrLink ?? null,
        panel: body.panel,
        createdById: access.userId,
      },
      include: interviewInclude,
    });

    await tx.hiringApplicationEvent.create({
      data: {
        applicationId: body.applicationId,
        type: "interview_scheduled",
        actorId: access.userId,
        payload: { kind: body.kind, scheduledAt: scheduledAt.toISOString(), panel: body.panel },
      },
    });

    return created;
  });

  return NextResponse.json({ interview: serializeInterview(interview) }, { status: 201 });
});
