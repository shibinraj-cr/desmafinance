import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_CATEGORIES,
  computeSalaryRun,
} from "@/lib/hr-salary-engine";

const CreateSchema = z.object({
  employeeId: z.string().min(1),
  kind: z.enum(ADJUSTMENT_KINDS),
  category: z.enum(ADJUSTMENT_CATEGORIES),
  // Amount is always positive; the direction is carried by `kind`.
  amount: z.number().positive().max(10_000_000),
  note: z.string().max(500).nullable().optional(),
});

// Create one itemised adjustment against a draft run for a given employee.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }

  const run = await prisma.hrSalaryRun.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "draft") {
    return NextResponse.json({ error: "run is approved; cannot edit" }, { status: 400 });
  }

  // An adjustment must attach to an employee who actually has a line in this run.
  const line = await prisma.hrSalaryRunLine.findUnique({
    where: { runId_employeeId: { runId: run.id, employeeId: parsed.data.employeeId } },
  });
  if (!line) {
    return NextResponse.json(
      { error: "no salary line for this employee in this run" },
      { status: 400 },
    );
  }

  const adjustment = await prisma.hrSalaryAdjustment.create({
    data: {
      runId: run.id,
      employeeId: parsed.data.employeeId,
      kind: parsed.data.kind,
      category: parsed.data.category,
      amount: parsed.data.amount,
      note: parsed.data.note ?? null,
      createdById: userId,
    },
  });
  // Recompute the run so a penalty re-runs through calcLine (recomputing ESI/PF
  // on the reduced salary) and the cached line/run totals stay correct.
  await computeSalaryRun(run.monthKey, userId);

  return NextResponse.json({ adjustment });
}
