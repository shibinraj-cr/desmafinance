import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";
import { computeSalaryRun } from "@/lib/hr-salary-engine";

const RunSchema = z.object({
  monthKey: z.string().regex(/^\d{4}-\d{2}$/),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const runs = await prisma.hrSalaryRun.findMany({
    orderBy: { monthKey: "desc" },
    include: { _count: { select: { lines: true } } },
  });
  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = RunSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const result = await computeSalaryRun(parsed.data.monthKey, userId);
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "salary_run_computed",
      entityType: "HrSalaryRun",
      entityId: result.runId,
      metadata: { monthKey: parsed.data.monthKey, lines: result.lineCount, warnings: result.warnings.slice(0, 50) },
    },
  });
  return NextResponse.json(result);
}
