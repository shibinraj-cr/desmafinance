import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { getPlannerBaseline } from "@/lib/lead-pulse-metrics";
import { computePlan } from "@/lib/lead-pulse-planner";
import { answerWhatIf } from "@/lib/lead-pulse-planner-ai";
import { todayIst } from "@/lib/lead-pulse-dates";

export const dynamic = "force-dynamic";

const Body = z.object({
  year: z.number().int().min(2024).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  target: z.number().int().min(0).max(1_000_000),
  l2ConvPct: z.number().min(0).max(100).optional(),
  l1ToTransferPct: z.number().min(0).max(100).optional(),
  question: z.string().min(1).max(600),
});

export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });

  const today = todayIst();
  const year = parsed.data.year ?? Number(today.slice(0, 4));
  const month = parsed.data.month ?? Number(today.slice(5, 7));

  const baseline = await getPlannerBaseline(year, month);
  const rates = {
    ...baseline.rates,
    ...(parsed.data.l2ConvPct != null ? { l2ConvPct: parsed.data.l2ConvPct } : {}),
    ...(parsed.data.l1ToTransferPct != null ? { l1ToTransferPct: parsed.data.l1ToTransferPct } : {}),
  };
  const plan = computePlan({
    targetClosedWon: parsed.data.target,
    rates,
    capacity: baseline.capacity,
    roster: baseline.roster,
    meta: {
      costPerQualifiedLead: baseline.meta.costPerQualifiedLead,
      currentQualifiedLeadsPerMonth: baseline.meta.qualifiedLeadsPerMonth,
      currentSpendPerMonth: baseline.meta.spendPerMonth,
    },
  });

  const result = await answerWhatIf({ ...baseline, rates }, plan, parsed.data.question);
  return NextResponse.json(result);
}
