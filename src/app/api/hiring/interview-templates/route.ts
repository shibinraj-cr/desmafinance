import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { conflict } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { INTERVIEW_KINDS, STAGE_KINDS } from "@/lib/hiring/constants";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(INTERVIEW_KINDS),
  durationMin: z.number().int().min(5).max(480).default(30),
  questionSet: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  isDefaultForStage: z.enum(STAGE_KINDS).nullable().optional(),
});

export const GET = withApiHandler(async () => {
  await requireHiring("interview:manage");
  const templates = await prisma.hiringInterviewTemplate.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ templates });
});

export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("interview:manage");
  const body = schema.parse(await req.json());
  const existing = await prisma.hiringInterviewTemplate.findUnique({ where: { name: body.name } });
  if (existing) throw conflict("There is already a template with that name.", "duplicate_template");

  const template = await prisma.hiringInterviewTemplate.create({
    data: {
      name: body.name,
      kind: body.kind,
      durationMin: body.durationMin,
      questionSet: body.questionSet as never,
      isDefaultForStage: body.isDefaultForStage ?? null,
      createdById: access.userId,
    },
  });
  return NextResponse.json({ template }, { status: 201 });
});
