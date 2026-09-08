import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { getCreditsState, setBudget, FEATURE_COSTS, FEATURE_LABELS } from "@/lib/hiring/ai/credits";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => {
  await requireHiring("self:read");
  const [state, byFeature] = await Promise.all([
    getCreditsState(),
    prisma.hiringAiCall.groupBy({
      by: ["feature"],
      where: { status: "ok" },
      _sum: { credits: true },
      _count: { _all: true },
    }),
  ]);
  return NextResponse.json({
    ...state,
    costs: FEATURE_COSTS,
    labels: FEATURE_LABELS,
    byFeature: byFeature.map((f) => ({
      feature: f.feature,
      credits: f._sum.credits ?? 0,
      calls: f._count._all,
    })),
  });
});

const schema = z.object({ budget: z.number().int().min(0).max(10_000_000) });

export const PUT = withApiHandler(async (req: Request) => {
  const access = await requireHiring("team:manage");
  const { budget } = schema.parse(await req.json());
  await setBudget(budget, access.userId);
  return NextResponse.json(await getCreditsState());
});
