import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { TRIGGER_TYPES, ACTION_TYPES, STARTER_RECIPES } from "@/lib/hiring/automations";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => {
  await requireHiring("automation:manage");
  const [automations, recentRuns] = await Promise.all([
    prisma.hiringAutomation.findMany({
      include: { owner: { select: { username: true } }, _count: { select: { runs: true } } },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.hiringAutomationRun.findMany({
      orderBy: { ranAt: "desc" },
      take: 50,
      include: { automation: { select: { name: true } } },
    }),
  ]);

  return NextResponse.json({
    automations: automations.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      isActive: a.isActive,
      trigger: a.trigger,
      actions: a.actions,
      lastFiredAt: a.lastFiredAt?.toISOString() ?? null,
      fireCount: a.fireCount,
      errorStreak: a.errorStreak,
      pausedAt: a.pausedAt?.toISOString() ?? null,
      pauseReason: a.pauseReason,
      ownerName: a.owner?.username ?? null,
      runCount: a._count.runs,
    })),
    runs: recentRuns.map((r) => ({
      id: r.id,
      automationName: r.automation.name,
      status: r.status,
      error: r.error,
      durationMs: r.durationMs,
      ranAt: r.ranAt.toISOString(),
    })),
    starters: STARTER_RECIPES,
  });
});

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  trigger: z.object({ type: z.enum(TRIGGER_TYPES), params: z.record(z.unknown()).optional() }),
  actions: z
    .array(z.object({ type: z.enum(ACTION_TYPES), params: z.record(z.unknown()).optional() }))
    .min(1)
    .max(10),
  isActive: z.boolean().default(false),
});

// Recipes are created INACTIVE by default — nothing should start acting on
// real candidates because somebody clicked a starter template to read it.
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("automation:manage");
  const body = schema.parse(await req.json());

  const automation = await prisma.hiringAutomation.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      trigger: body.trigger as never,
      actions: body.actions as never,
      isActive: body.isActive,
      ownerId: access.userId,
      createdById: access.userId,
    },
  });

  return NextResponse.json({ automation }, { status: 201 });
});
