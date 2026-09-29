import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

/**
 * Statutory PF rule master (HrPfRule).
 *
 * A future EPFO amendment is implemented HERE — by adding a new
 * effective-dated rule — never by changing application code. Creating a rule
 * closes the currently open one the day before the new effectiveFrom, so the
 * history stays gap-free and historical payroll periods keep resolving the
 * rule that governed them.
 */

const DAY = 86_400_000;

const CreateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]{3,40}$/, "code must be A–Z, 0–9 and _")
    .optional(),
  wageCeiling: z.number().positive().max(10_000_000),
  employeeRatePct: z.number().positive().max(100).default(12),
  employerRatePct: z.number().positive().max(100).default(12),
  epsRatePct: z.number().min(0).max(100).default(8.33),
  epsApplicable: z.boolean().default(true),
  higherWageAllowed: z.boolean().default(true),
  /** yyyy-mm-dd */
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rules = await prisma.hrPfRule.findMany({ orderBy: { effectiveFrom: "desc" } });
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const effectiveFrom = new Date(`${d.effectiveFrom}T00:00:00.000Z`);
  if (isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "invalid effectiveFrom" }, { status: 400 });
  }
  if (d.epsApplicable && d.epsRatePct > d.employerRatePct) {
    return NextResponse.json(
      { error: "EPS % cannot exceed the employer contribution %" },
      { status: 400 },
    );
  }

  // The new rule must start strictly after every existing rule — statutory
  // history is append-only. Rewriting the past would silently change what a
  // historical recompute pays; that is exactly what this model exists to
  // prevent.
  const latest = await prisma.hrPfRule.findFirst({ orderBy: { effectiveFrom: "desc" } });
  if (latest && effectiveFrom.getTime() <= latest.effectiveFrom.getTime()) {
    return NextResponse.json(
      {
        error: `Effective-from must be after ${latest.effectiveFrom.toISOString().slice(0, 10)} (rule ${latest.code}). Statutory history is append-only.`,
      },
      { status: 400 },
    );
  }

  const code = d.code ?? `PF_RULE_${d.effectiveFrom.replaceAll("-", "")}`;
  const dup = await prisma.hrPfRule.findUnique({ where: { code } });
  if (dup) return NextResponse.json({ error: `code ${code} already exists` }, { status: 400 });

  const rule = await prisma.$transaction(async (tx) => {
    if (latest && latest.effectiveTo === null) {
      await tx.hrPfRule.update({
        where: { id: latest.id },
        data: { effectiveTo: new Date(effectiveFrom.getTime() - DAY) },
      });
    }
    return tx.hrPfRule.create({
      data: {
        code,
        wageCeiling: d.wageCeiling,
        employeeRatePct: d.employeeRatePct,
        employerRatePct: d.employerRatePct,
        epsRatePct: d.epsRatePct,
        epsApplicable: d.epsApplicable,
        higherWageAllowed: d.higherWageAllowed,
        effectiveFrom,
        effectiveTo: null,
        notes: d.notes ?? null,
        createdById: userId,
      },
    });
  });
  return NextResponse.json({ rule });
}
