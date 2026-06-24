/**
 * Revert Sivapriya's 12 Apr 2026 from Absent → Week-Off. The sandwich rule had
 * flipped it (WO→A) because 11 & 13 Apr were leave; the 11th was since
 * regularized to Present, so the sandwich no longer applies. Then refresh her
 * leave balance and recompute the 2026-04 salary draft.
 *
 *   npx tsx prisma/revise-siva-apr12.ts            # DRY RUN
 *   npx tsx prisma/revise-siva-apr12.ts --commit   # write
 */
import { PrismaClient } from "@prisma/client";
import { cycleWindowForMonth } from "../src/lib/hr-data";
import { recomputeLeaveBalance } from "../src/lib/hr-leave-balance";
import { computeSalaryRun } from "../src/lib/hr-salary-engine";

const prisma = new PrismaClient();
const APR12 = new Date(Date.UTC(2026, 3, 12));
const APR11 = new Date(Date.UTC(2026, 3, 11));

async function main() {
  const commit = process.argv.includes("--commit");
  const emp = await prisma.employee.findFirst({ where: { name: { equals: "Sivapriya Sivakumar", mode: "insensitive" } }, select: { id: true, empCode: true, name: true } });
  if (!emp) throw new Error("employee not found");

  const d12 = await prisma.hrAttendanceDay.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: APR12 } } });
  const d11 = await prisma.hrAttendanceDay.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: APR11 } } });
  if (!d12) throw new Error("no attendance row for 12 Apr");
  console.log(`12 Apr: status=${d12.status} raw=${d12.rawStatus ?? "-"} note=${d12.decisionNote ?? "-"}`);
  console.log(`11 Apr: status=${d11?.status ?? "(none)"}`);

  // Safety: only revert if it's the sandwich-flipped A and the anchor is now P.
  if (d12.status !== "A") throw new Error(`12 Apr is "${d12.status}", not A — aborting (already changed?)`);
  if (d11?.status !== "P") throw new Error(`11 Apr is "${d11?.status}", not P — the sandwich anchor isn't cleared; aborting`);
  const target = d12.rawStatus === "WO" || d12.rawStatus === "HL" ? d12.rawStatus : "WO";

  if (!commit) { console.log(`DRY RUN — would set 12 Apr → ${target}, refresh balance, recompute 2026-04. Pass --commit.`); return; }

  await prisma.$transaction([
    prisma.hrAttendanceDay.update({
      where: { id: d12.id },
      data: { status: target, decidedById: null, decidedAt: new Date(), decisionNote: "Reverted sandwich A→WO: anchor (11 Apr) regularized to Present" },
    }),
    prisma.hrAuditLog.create({
      data: { actorUserId: null, eventType: "sandwich_revert_manual", entityType: "HrAttendanceDay", entityId: d12.id, metadata: { employeeId: emp.id, date: "2026-04-12", from: "A", to: target, reason: "11 Apr regularized to P — sandwich no longer applies" } },
    }),
  ]);
  console.log(`✓ 12 Apr set to ${target}`);

  const { year } = cycleWindowForMonth("2026-04");
  const bal = await recomputeLeaveBalance(emp.id, year);
  console.log(`✓ balance refreshed: opening=${bal.opening} accrued=${bal.accrued} used=${bal.used} balance=${bal.balance}`);

  const res = await computeSalaryRun("2026-04", null);
  console.log(`✓ salary draft recomputed: lines=${res.lineCount}`);

  const run = await prisma.hrSalaryRun.findUnique({ where: { monthKey: "2026-04" }, select: { id: true } });
  const l = run && (await prisma.hrSalaryRunLine.findFirst({ where: { runId: run.id, employeeId: emp.id }, select: { paidLeave: true, unpaidLeave: true, totalLeaveForLop: true, netSalary: true } }));
  console.log(`  Sivapriya line: PL=${l && Number(l.paidLeave)} unpaid=${l && Number(l.unpaidLeave)} LOP=${l && Number(l.totalLeaveForLop)} net=${l && Number(l.netSalary)}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
