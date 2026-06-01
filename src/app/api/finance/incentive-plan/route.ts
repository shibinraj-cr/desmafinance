import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { serializePlan } from "@/lib/incentive";

export const dynamic = "force-dynamic";

const PAGE = "/finance/incentive-calculator";

const count = z.coerce.number().int().min(0).max(1_000_000);
const money = z.coerce.number().int().min(0).max(100_000_000);

const BdeInput = z.object({
  name: z.string().trim().min(1).max(80),
  minimum: count,
  target: count,
  enrol: count,
  fast48: count,
  selfRef: count,
});

const PlanInput = z.object({
  period: z.string().trim().min(1).max(40),
  baseRate: money,
  boostThreshold: count,
  boostRate: money,
  individualBonus: money,
  fastBonus: money,
  refBonus: money,
  teamTarget: count,
  teamPool: money,
  distMethod: z.enum(["equal", "enrolments", "achievers"]),
  requireMin: z.boolean(),
  bdes: z.array(BdeInput).max(60),
});

async function listPeriods(): Promise<string[]> {
  const rows = await prisma.incentivePlan.findMany({
    select: { period: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => r.period);
}

// GET /api/finance/incentive-plan?period=June%202026
// Read-only: returns the saved plan for the period (or null) plus the list of
// periods that already have a plan. The client falls back to built-in defaults
// when `plan` is null; the first autosave (PUT) persists it.
export async function GET(req: NextRequest) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePage(perms, PAGE)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const period = (new URL(req.url).searchParams.get("period") ?? "").trim();
  if (!period) return NextResponse.json({ error: "period_required" }, { status: 400 });

  const plan = await prisma.incentivePlan.findUnique({
    where: { period },
    include: { bdes: { orderBy: { sortIndex: "asc" } } },
  });

  return NextResponse.json({
    plan: plan ? serializePlan(plan) : null,
    periods: await listPeriods(),
  });
}

// PUT /api/finance/incentive-plan
// Upsert the plan for its period and replace the whole roster.
export async function PUT(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePage(perms, PAGE)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PlanInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const d = parsed.data;
  const rules = {
    baseRate: d.baseRate,
    boostThreshold: d.boostThreshold,
    boostRate: d.boostRate,
    individualBonus: d.individualBonus,
    fastBonus: d.fastBonus,
    refBonus: d.refBonus,
    teamTarget: d.teamTarget,
    teamPool: d.teamPool,
    distMethod: d.distMethod,
    requireMin: d.requireMin,
    updatedById: userId,
  };

  const head = await prisma.incentivePlan.upsert({
    where: { period: d.period },
    create: { period: d.period, ...rules },
    update: rules,
    select: { id: true },
  });

  // Replace the roster wholesale. Batch (array) transaction — works over the
  // pooled pgbouncer connection, unlike interactive transactions.
  await prisma.$transaction([
    prisma.incentiveBde.deleteMany({ where: { planId: head.id } }),
    prisma.incentiveBde.createMany({
      data: d.bdes.map((b, i) => ({
        planId: head.id,
        name: b.name,
        minimum: b.minimum,
        target: b.target,
        enrol: b.enrol,
        fast48: b.fast48,
        selfRef: b.selfRef,
        sortIndex: i,
      })),
    }),
  ]);

  const plan = await prisma.incentivePlan.findUniqueOrThrow({
    where: { id: head.id },
    include: { bdes: { orderBy: { sortIndex: "asc" } } },
  });

  return NextResponse.json({ ok: true, plan: serializePlan(plan), periods: await listPeriods() });
}
