import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const Schema = z.object({
  adjustments: z.number(),
  adjustmentNote: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; lineId: string } },
) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const run = await prisma.hrSalaryRun.findUnique({ where: { id: params.id } });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (run.status !== "draft") {
    return NextResponse.json({ error: "run is approved; cannot edit" }, { status: 400 });
  }
  const line = await prisma.hrSalaryRunLine.update({
    where: { id: params.lineId },
    data: {
      adjustments: parsed.data.adjustments,
      adjustmentNote: parsed.data.adjustmentNote ?? null,
    },
  });
  const lines = await prisma.hrSalaryRunLine.findMany({ where: { runId: run.id } });
  const totalNet = lines.reduce(
    (s, l) => s + Number(l.netSalary) + Number(l.adjustments),
    0,
  );
  await prisma.hrSalaryRun.update({ where: { id: run.id }, data: { totalNet } });
  return NextResponse.json({ line });
}
