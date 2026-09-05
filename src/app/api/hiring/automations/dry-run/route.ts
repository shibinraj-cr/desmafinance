import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { TRIGGER_TYPES, timeTriggerWhere, type Trigger } from "@/lib/hiring/automations";

export const dynamic = "force-dynamic";

const schema = z.object({
  trigger: z.object({ type: z.enum(TRIGGER_TYPES), params: z.record(z.unknown()).optional() }),
});

/**
 * POST /api/hiring/automations/dry-run — "which candidates would this touch?"
 *
 * Reads only. For time-based triggers it runs the SAME query the engine will,
 * so the answer is not an estimate. For event triggers there is nothing to
 * match against yet — the honest answer is "next time it happens", and the
 * response says so rather than inventing a number.
 */
export const POST = withApiHandler(async (req: Request) => {
  await requireHiring("automation:manage");
  const { trigger } = schema.parse(await req.json());

  const where = timeTriggerWhere(trigger as Trigger);
  if (!where) {
    return NextResponse.json({
      kind: "event",
      message:
        "This recipe reacts to something happening, so there is nothing to match right now — " +
        "it will fire the next time that event occurs.",
      matches: [],
    });
  }

  const matches = await prisma.hiringApplication.findMany({
    where,
    select: {
      id: true,
      stageEnteredAt: true,
      lastContactedAt: true,
      candidate: { select: { fullName: true } },
      job: { select: { title: true } },
      stage: { select: { name: true } },
    },
    orderBy: { stageEnteredAt: "asc" },
    take: 100,
  });
  const total = await prisma.hiringApplication.count({ where });

  return NextResponse.json({
    kind: "time",
    total,
    truncated: total > matches.length,
    matches: matches.map((m) => ({
      id: m.id,
      name: m.candidate.fullName,
      jobTitle: m.job.title,
      stageName: m.stage?.name ?? null,
      stageEnteredAt: m.stageEnteredAt.toISOString(),
      lastContactedAt: m.lastContactedAt?.toISOString() ?? null,
    })),
  });
});
