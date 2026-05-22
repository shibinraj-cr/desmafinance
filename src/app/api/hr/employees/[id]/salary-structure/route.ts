import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const Schema = z.object({
  effectiveFrom: z.string().min(7),
  monthlySalary: z.number().nonnegative(),
  basicPct: z.number().min(0).max(100).default(50),
  esiApplicable: z.boolean().default(true),
  pfApplicable: z.boolean().default(true),
  professionalTax: z.number().nonnegative().default(125),
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
  const row = await prisma.hrSalaryStructure.upsert({
    where: { employeeId_effectiveFrom: { employeeId: params.id, effectiveFrom } },
    update: {
      monthlySalary: d.monthlySalary,
      basicPct: d.basicPct,
      esiApplicable: d.esiApplicable,
      pfApplicable: d.pfApplicable,
      professionalTax: d.professionalTax,
      notes: d.notes ?? null,
    },
    create: {
      employeeId: params.id,
      effectiveFrom,
      monthlySalary: d.monthlySalary,
      basicPct: d.basicPct,
      esiApplicable: d.esiApplicable,
      pfApplicable: d.pfApplicable,
      professionalTax: d.professionalTax,
      notes: d.notes ?? null,
    },
  });
  return NextResponse.json({ structure: row });
}
