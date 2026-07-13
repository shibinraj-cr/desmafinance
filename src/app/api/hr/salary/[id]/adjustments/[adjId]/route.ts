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

const PatchSchema = z
  .object({
    kind: z.enum(ADJUSTMENT_KINDS).optional(),
    category: z.enum(ADJUSTMENT_CATEGORIES).optional(),
    amount: z.number().positive().max(10_000_000).optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });

/** Load the adjustment and confirm it belongs to an editable (draft) run. */
async function loadEditable(runId: string, adjId: string) {
  const run = await prisma.hrSalaryRun.findUnique({ where: { id: runId } });
  if (!run) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  if (run.status !== "draft") {
    return { error: NextResponse.json({ error: "run is approved; cannot edit" }, { status: 400 }) };
  }
  const adjustment = await prisma.hrSalaryAdjustment.findFirst({ where: { id: adjId, runId } });
  if (!adjustment) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { run, adjustment };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; adjId: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }

  const loaded = await loadEditable(params.id, params.adjId);
  if (loaded.error) return loaded.error;

  const updated = await prisma.hrSalaryAdjustment.update({
    where: { id: params.adjId },
    data: {
      ...(parsed.data.kind !== undefined ? { kind: parsed.data.kind } : {}),
      ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
      ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    },
  });
  await computeSalaryRun(loaded.run.monthKey, userId);

  return NextResponse.json({ adjustment: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; adjId: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const loaded = await loadEditable(params.id, params.adjId);
  if (loaded.error) return loaded.error;

  await prisma.hrSalaryAdjustment.delete({ where: { id: params.adjId } });
  await computeSalaryRun(loaded.run.monthKey, userId);

  return NextResponse.json({ ok: true });
}
