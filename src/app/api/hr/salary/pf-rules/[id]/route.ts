import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

/**
 * Delete a SCHEDULED (future-dated, never-applied) PF rule and reopen the
 * previous rule as the active one. Rules that are or were in force are
 * immutable — payroll audit trails reference them.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rule = await prisma.hrPfRule.findUnique({ where: { id: params.id } });
  if (!rule) return NextResponse.json({ error: "not found" }, { status: 404 });

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (rule.effectiveFrom.getTime() <= todayUtc) {
    return NextResponse.json(
      { error: "Only a future-dated (scheduled) rule can be deleted. Rules that have been in force are immutable." },
      { status: 400 },
    );
  }
  const later = await prisma.hrPfRule.findFirst({
    where: { effectiveFrom: { gt: rule.effectiveFrom } },
  });
  if (later) {
    return NextResponse.json(
      { error: "Delete the most recent scheduled rule first." },
      { status: 400 },
    );
  }
  const applied = await prisma.hrSalaryRunLine.findFirst({ where: { pfRuleId: rule.id } });
  if (applied) {
    return NextResponse.json(
      { error: "This rule has already been applied to a salary run and cannot be deleted." },
      { status: 400 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.hrPfRule.delete({ where: { id: rule.id } });
    // Reopen the rule this one had closed, so there is no dangling gap.
    const prev = await tx.hrPfRule.findFirst({ orderBy: { effectiveFrom: "desc" } });
    if (prev && prev.effectiveTo !== null) {
      await tx.hrPfRule.update({ where: { id: prev.id }, data: { effectiveTo: null } });
    }
  });
  return NextResponse.json({ ok: true });
}
