/**
 * Recompute the 2026-04 salary draft under the fixed leave-coverage engine.
 *   npx tsx prisma/recompute-2026-04.ts            # DRY RUN
 *   npx tsx prisma/recompute-2026-04.ts --commit   # write
 * Only touches the draft run (computeSalaryRun keeps status=draft).
 */
import { PrismaClient } from "@prisma/client";
import { computeSalaryRun } from "../src/lib/hr-salary-engine";
const prisma = new PrismaClient();
const MONTH = "2026-04";

async function main() {
  const commit = process.argv.includes("--commit");
  const run = await prisma.hrSalaryRun.findUnique({ where: { monthKey: MONTH }, select: { id: true, status: true, totalNet: true } });
  console.log(`run ${MONTH}: status=${run?.status} totalNet(before)=${run ? Number(run.totalNet) : "n/a"}`);
  if (run && run.status !== "draft") throw new Error(`run is ${run.status}, not draft — refusing to recompute`);
  if (!commit) { console.log("DRY RUN — pass --commit to write."); return; }

  const res = await computeSalaryRun(MONTH, null);
  console.log(`recomputed: lines=${res.lineCount}, warnings=${res.warnings.length}`);
  for (const w of res.warnings) console.log("  ⚠ " + w);

  const after = await prisma.hrSalaryRun.findUnique({ where: { monthKey: MONTH }, select: { id: true, totalNet: true } });
  console.log(`totalNet(after)=${after ? Number(after.totalNet) : "n/a"}`);
  // spot-check the previously over-charged people
  for (const code of ["0002", "0006", "0007", "0012", "0016"]) {
    const emp = await prisma.employee.findFirst({ where: { empCode: code }, select: { id: true, name: true } });
    if (!emp || !after) continue;
    const l = await prisma.hrSalaryRunLine.findFirst({ where: { runId: after.id, employeeId: emp.id }, select: { totalLeaveForLop: true, paidLeave: true, unpaidLeave: true, netSalary: true } });
    console.log(`  ${code} ${emp.name}: LOP=${l && Number(l.totalLeaveForLop)} PL=${l && Number(l.paidLeave)} unpaid=${l && Number(l.unpaidLeave)} net=${l && Number(l.netSalary)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
