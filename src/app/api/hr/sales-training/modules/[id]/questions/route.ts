import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const QuestionInput = z
  .object({
    /** Existing question id; omit for a new question. */
    id: z.string().optional(),
    kind: z.enum(["single", "multi"]),
    prompt: z.string().trim().min(1, "Every question needs text.").max(2000),
    options: z.array(z.string().trim().min(1, "Options can't be blank.").max(500)).min(2, "Each question needs at least two options.").max(10),
    correct: z.array(z.number().int().min(0)).min(1, "Mark at least one right option."),
    points: z.number().int().min(1).max(100),
    explanation: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((q) => q.correct.every((i) => i < q.options.length), "A right answer points at a missing option.")
  .refine((q) => q.kind === "multi" || q.correct.length === 1, "Single-answer questions take exactly one right option.");

const Schema = z.object({ questions: z.array(QuestionInput).max(200) });

/**
 * Replace the module's whole question bank. Past attempts keep their own
 * snapshot, so editing or removing a question never changes an old score.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const qNo = typeof issue?.path[1] === "number" ? `Question ${issue.path[1] + 1}: ` : "";
    return NextResponse.json({ error: qNo + (issue?.message ?? "invalid") }, { status: 400 });
  }
  const mod = await prisma.salesTrainingModule.findUnique({
    where: { id: params.id },
    include: { questions: { select: { id: true } } },
  });
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  const qs = parsed.data.questions;
  if (mod.status === "published" && qs.length === 0) {
    return NextResponse.json({ error: "A published module needs at least one question." }, { status: 400 });
  }

  const existing = new Set(mod.questions.map((q) => q.id));
  const keep = new Set(qs.map((q) => q.id).filter((id): id is string => !!id && existing.has(id)));
  await prisma.$transaction([
    prisma.salesTrainingQuestion.deleteMany({ where: { moduleId: mod.id, id: { notIn: [...keep] } } }),
    ...qs.map((q, i) => {
      const data = {
        sortOrder: i + 1,
        kind: q.kind,
        prompt: q.prompt,
        options: q.options,
        correct: [...new Set(q.correct)].sort((a, b) => a - b),
        points: q.points,
        explanation: q.explanation || null,
      };
      return q.id && keep.has(q.id)
        ? prisma.salesTrainingQuestion.update({ where: { id: q.id }, data })
        : prisma.salesTrainingQuestion.create({ data: { ...data, moduleId: mod.id } });
    }),
  ]);
  return NextResponse.json({ ok: true });
}
