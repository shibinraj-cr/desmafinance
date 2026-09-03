import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { interviewInclude, serializeInterview } from "@/lib/hiring/interviews";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  durationMin: z.number().int().min(5).max(480).optional(),
  mode: z.enum(["in_person", "video", "phone"]).optional(),
  locationOrLink: z.string().trim().max(500).nullable().optional(),
  panel: z.array(z.string().min(1)).max(10).optional(),
  status: z.enum(["scheduled", "completed", "no_show", "cancelled", "rescheduled"]).optional(),
  recordingUrl: z.string().trim().max(1000).nullable().optional(),
  transcriptText: z.string().max(200_000).nullable().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("interview:manage");
  const body = patchSchema.parse(await req.json());

  const before = await prisma.hiringInterview.findUnique({ where: { id: params.id } });
  if (!before) throw notFound("That interview no longer exists.");

  const interview = await prisma.hiringInterview.update({
    where: { id: params.id },
    data: {
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
      durationMin: body.durationMin,
      mode: body.mode,
      locationOrLink: body.locationOrLink,
      panel: body.panel,
      status: body.status,
      recordingUrl: body.recordingUrl,
      transcriptText: body.transcriptText,
      transcriptSource: body.transcriptText ? "manual" : undefined,
      // Rescheduling resets the nudge clock: the reminders belong to the new
      // sitting, not the one that did not happen.
      ...(body.scheduledAt ? { nudged2hAt: null, nudged24hAt: null } : {}),
    },
    include: interviewInclude,
  });

  return NextResponse.json({ interview: serializeInterview(interview) });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireHiring("interview:manage");
  const interview = await prisma.hiringInterview.findUnique({ where: { id: params.id } });
  if (!interview) throw notFound("That interview no longer exists.");

  // Cancelled, not deleted: the calendar feed has to publish it as CANCELLED or
  // it stays on everyone's calendar forever.
  await prisma.hiringInterview.update({ where: { id: params.id }, data: { status: "cancelled" } });
  return NextResponse.json({ ok: true });
});
