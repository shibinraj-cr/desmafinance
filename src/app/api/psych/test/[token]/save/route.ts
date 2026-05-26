import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { findAssignmentByRawToken } from "@/lib/psych-tokens";

const Body = z.object({
  responses: z
    .array(
      z.object({
        questionId: z.string().min(1),
        value: z.number().int().min(1).max(5),
      }),
    )
    .min(1),
});

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const assignment = await findAssignmentByRawToken(params.token);
  if (!assignment) return NextResponse.json({ error: "invalid_token" }, { status: 404 });
  if (assignment.status === "COMPLETED" || assignment.status === "INVALIDATED")
    return NextResponse.json({ error: "not_active" }, { status: 410 });
  if (assignment.expiresAt < new Date())
    return NextResponse.json({ error: "expired" }, { status: 410 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });

  // Constrain question ids to ones that belong to this assignment's test.
  const allowedIds = new Set(assignment.test.questions.map((q) => q.id));
  const valid = parsed.data.responses.filter((r) => allowedIds.has(r.questionId));

  // Lazily flip status to IN_PROGRESS on the first save.
  await prisma.$transaction([
    ...valid.map((r) =>
      prisma.psychResponse.upsert({
        where: { assignmentId_questionId: { assignmentId: assignment.id, questionId: r.questionId } },
        create: { assignmentId: assignment.id, questionId: r.questionId, value: r.value },
        update: { value: r.value, savedAt: new Date() },
      }),
    ),
    prisma.psychAssignment.update({
      where: { id: assignment.id },
      data: {
        status: assignment.status === "ASSIGNED" ? "IN_PROGRESS" : assignment.status,
        startedAt: assignment.startedAt ?? new Date(),
      },
    }),
  ]);

  return NextResponse.json({ ok: true, saved: valid.length });
}
