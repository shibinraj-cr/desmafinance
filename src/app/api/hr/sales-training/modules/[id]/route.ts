import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { parseYouTubeId, type TrainingVideo } from "@/lib/sales-training";
import { notifyEmployees } from "@/lib/sales-training-db";

const VideoInput = z.object({
  /** Stable id; keep it when editing a title so learners' watch progress survives. */
  id: z.string().min(1).max(64),
  title: z.string().trim().max(200),
  url: z.string().trim().min(1).max(500),
});

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  passMark: z.number().int().min(0).max(100).optional(),
  maxAttempts: z.number().int().min(1).max(100).nullable().optional(),
  requireWatch: z.boolean().optional(),
  videos: z.array(VideoInput).max(30).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, { status: 400 });
  }
  const mod = await prisma.salesTrainingModule.findUnique({
    where: { id: params.id },
    include: { _count: { select: { questions: true } } },
  });
  if (!mod) return NextResponse.json({ error: "not found" }, { status: 404 });
  const d = parsed.data;

  let videos: TrainingVideo[] | undefined;
  if (d.videos) {
    videos = [];
    for (const [i, v] of d.videos.entries()) {
      const youtubeId = parseYouTubeId(v.url);
      if (!youtubeId) {
        return NextResponse.json({ error: `Video ${i + 1}: not a YouTube link — "${v.url}"` }, { status: 400 });
      }
      videos.push({ id: v.id, title: v.title || `Video ${i + 1}`, youtubeId });
    }
  }

  if (d.status === "published" && mod._count.questions === 0) {
    return NextResponse.json({ error: "Add at least one question before publishing." }, { status: 400 });
  }

  const updated = await prisma.salesTrainingModule.update({
    where: { id: mod.id },
    data: {
      title: d.title,
      description: d.description === undefined ? undefined : d.description || null,
      passMark: d.passMark,
      maxAttempts: d.maxAttempts,
      requireWatch: d.requireWatch,
      videos,
      status: d.status,
    },
  });

  // First time a module goes live, tell every active learner.
  if (d.status === "published" && mod.status !== "published") {
    const learners = await prisma.salesTrainingLearner.findMany({ where: { active: true }, select: { employeeId: true } });
    await notifyEmployees(
      learners.map((l) => l.employeeId),
      {
        title: `New sales training module: ${updated.title}`,
        body: updated.description ?? "A new module is ready in your Sales Training.",
        linkUrl: `/me/sales-training/${updated.id}`,
        createdById: userId,
      },
    );
  }
  return NextResponse.json({ ok: true });
}

/**
 * Delete a module. Once anyone has attempted it the scores are history worth
 * keeping, so it can only be archived from then on.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const attempts = await prisma.salesTrainingAttempt.count({ where: { moduleId: params.id } });
  if (attempts > 0) {
    return NextResponse.json(
      { error: `${attempts} attempt(s) already recorded — archive the module instead of deleting it.` },
      { status: 409 },
    );
  }
  await prisma.salesTrainingModule.delete({ where: { id: params.id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
