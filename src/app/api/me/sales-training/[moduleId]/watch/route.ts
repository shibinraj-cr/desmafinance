import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { mergeRanges, watchedPct, WATCH_THRESHOLD_PCT, type Range } from "@/lib/sales-training";
import { activeLearner, toVideos } from "@/lib/sales-training-db";

const Schema = z.object({
  videoId: z.string().min(1).max(64),
  durationSec: z.number().min(1).max(24 * 3600),
  ranges: z.array(z.tuple([z.number().min(0), z.number().min(0)])).max(500),
});

/**
 * Record which seconds of a video the learner actually played. Ranges are
 * unioned with what's stored, so progress accumulates across sessions and a
 * skip-ahead only ever counts the part that played.
 */
export async function POST(req: Request, { params }: { params: { moduleId: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp || !(await activeLearner(emp.id))) return NextResponse.json({ error: "not enrolled" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const mod = await prisma.salesTrainingModule.findUnique({ where: { id: params.moduleId } });
  if (!mod || mod.status !== "published") return NextResponse.json({ error: "not available" }, { status: 404 });
  const { videoId } = parsed.data;
  if (!toVideos(mod.videos).some((v) => v.id === videoId)) {
    return NextResponse.json({ error: "unknown video" }, { status: 400 });
  }

  const key = { moduleId_employeeId_videoId: { moduleId: mod.id, employeeId: emp.id, videoId } };
  const prev = await prisma.salesTrainingWatch.findUnique({ where: key });
  const durationSec = Math.max(prev?.durationSec ?? 0, Math.round(parsed.data.durationSec));
  const ranges = mergeRanges([...((prev?.ranges as Range[] | undefined) ?? []), ...(parsed.data.ranges as Range[])]).map(
    ([a, b]) => [Math.min(a, durationSec), Math.min(b, durationSec)] as Range,
  );
  const pct = watchedPct(ranges, durationSec);
  const completedAt = prev?.completedAt ?? (pct >= WATCH_THRESHOLD_PCT ? new Date() : null);

  await prisma.salesTrainingWatch.upsert({
    where: key,
    create: { moduleId: mod.id, employeeId: emp.id, videoId, ranges, durationSec, watchedPct: pct, completedAt },
    update: { ranges, durationSec, watchedPct: pct, completedAt },
  });
  return NextResponse.json({ watchedPct: pct, completed: !!completedAt });
}
