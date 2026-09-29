import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { DEFAULT_ALLOWANCE_PCTS, suggestProfessionalTax, deriveBreakdown } from "@/lib/hr-salary-engine";

const Schema = z.object({
  effectiveFrom: z.string().min(7),
  basic: z.number().positive(),
  hraPct: z.number().min(0).max(200).default(DEFAULT_ALLOWANCE_PCTS.hra),
  conveyancePct: z.number().min(0).max(200).default(DEFAULT_ALLOWANCE_PCTS.conveyance),
  medicalPct: z.number().min(0).max(200).default(DEFAULT_ALLOWANCE_PCTS.medical),
  specialPct: z.number().min(0).max(200).default(DEFAULT_ALLOWANCE_PCTS.special),
  esiApplicable: z.boolean().optional(),
  pfApplicable: z.boolean().default(true),
  // PF contribution basis: "ceiling" (statutory wage ceiling — default) or
  // "actual" (contribute on full PF wages above the ceiling; higher-wage
  // members are never auto-reduced by a ceiling change). When omitted —
  // e.g. the quick "Update Basic" flow posts only {effectiveFrom, basic} —
  // the employee's latest saved basis carries forward instead of resetting.
  pfBasis: z.enum(["ceiling", "actual"]).optional(),
  // Voluntary EXTRA employee PF % (VPF) on the eligible wage; no employer
  // match. Omitted → carried forward like pfBasis; explicit null clears it.
  pfVoluntaryPct: z.number().min(0).max(88).nullable().optional(),
  professionalTax: z.number().nonnegative().optional(),
  notes: z.string().nullable().optional(),
});

function toDate(s: string): Date {
  if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00.000Z`);
  return new Date(s);
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await prisma.hrSalaryStructure.findMany({
    where: { employeeId: params.id },
    orderBy: { effectiveFrom: "desc" },
  });
  return NextResponse.json({ structures: rows });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const effectiveFrom = toDate(d.effectiveFrom);

  // Auto-derive ESI applicability and PT if not provided.
  const breakdown = deriveBreakdown(d.basic, d);
  const esiApplicable = d.esiApplicable ?? breakdown.gross <= 21000;
  const professionalTax = d.professionalTax ?? suggestProfessionalTax(breakdown.gross);

  // PF basis / VPF carry forward from the latest structure when the caller
  // doesn't send them, so a quick Basic update can never silently reset a
  // higher-wage ("actual") member to the statutory ceiling.
  const prev = await prisma.hrSalaryStructure.findFirst({
    where: { employeeId: params.id },
    orderBy: { effectiveFrom: "desc" },
  });
  const pfBasis = d.pfBasis ?? (prev?.pfBasis === "actual" ? "actual" : "ceiling");
  const pfVoluntaryPct =
    d.pfVoluntaryPct !== undefined
      ? d.pfVoluntaryPct
      : prev?.pfVoluntaryPct != null
        ? Number(prev.pfVoluntaryPct)
        : null;

  const row = await prisma.hrSalaryStructure.upsert({
    where: { employeeId_effectiveFrom: { employeeId: params.id, effectiveFrom } },
    update: {
      basic: d.basic,
      hraPct: d.hraPct,
      conveyancePct: d.conveyancePct,
      medicalPct: d.medicalPct,
      specialPct: d.specialPct,
      esiApplicable,
      pfApplicable: d.pfApplicable,
      pfBasis,
      pfVoluntaryPct,
      professionalTax,
      notes: d.notes ?? null,
    },
    create: {
      employeeId: params.id,
      effectiveFrom,
      basic: d.basic,
      hraPct: d.hraPct,
      conveyancePct: d.conveyancePct,
      medicalPct: d.medicalPct,
      specialPct: d.specialPct,
      esiApplicable,
      pfApplicable: d.pfApplicable,
      pfBasis,
      pfVoluntaryPct,
      professionalTax,
      notes: d.notes ?? null,
    },
  });
  return NextResponse.json({ structure: row });
}
