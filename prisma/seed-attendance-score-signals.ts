/**
 * Seed the score-only behavioural overlay (HrAttendanceScoreSignal) for the
 * Apr–Jun 2026 backfill.
 *
 * The corrected attendance uploaded to prod cleaned out the real late-comings,
 * missing punches and early departures. These are still present in the raw
 * biometric export kept in ./score. This script ingests those RAW behavioural
 * signals into HrAttendanceScoreSignal so the Attendance Scorecard can score the
 * employees' ACTUAL behaviour — WITHOUT touching HrAttendanceDay (payroll, leave
 * and the attendance grid are unaffected; presence stays from the corrected
 * record).
 *
 * Parity with the biometric upload route:
 *   - names matched by fuzzy first-token / overlap (never by empCode),
 *   - weekday lateMinutes recomputed vs the resolved HR shift start,
 *   - Saturday late/early-out already recomputed by the parser (09:00 / 16:00).
 * Only days with at least one punch are stored (a no-punch day carries no
 * behavioural signal). Idempotent: deletes this source's rows then reinserts.
 *
 *   npx tsx --env-file=.env prisma/seed-attendance-score-signals.ts            # DRY RUN
 *   npx tsx --env-file=.env prisma/seed-attendance-score-signals.ts --commit
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { parseAttendanceWorkbook } from "../src/lib/hr-attendance-parser";
import { resolveShiftForDate } from "../src/lib/hr-shift";
import { cycleMonthForDate, cycleWindowForMonth, SHIFT_GRACE_MINUTES } from "../src/lib/hr-data";

const prisma = new PrismaClient();

const SOURCE = "biometric_backfill_2026Q2";
// Folder holding the raw biometric exports (override with SCORE_DIR).
const SCORE_DIR = process.env.SCORE_DIR ?? "score";
const FILES = ["26032026 - 2505206.xls", "26052026 - 25062026.xls"].map((f) => `${SCORE_DIR}/${f}`);
const CYCLES = ["2026-04", "2026-05", "2026-06"];

function nameTokens(s: string): string[] {
  return String(s ?? "").toLowerCase().replace(/[.,()]/g, "").split(/\s+/).filter(Boolean);
}
function fuzzyMatchEmployee(rawName: string, employees: { id: string; name: string; empCode: string }[]): string | null {
  const aTokens = nameTokens(rawName);
  if (!aTokens.length) return null;
  const aFirst = aTokens[0];
  let best: { id: string; score: number } | null = null;
  for (const e of employees) {
    const bTokens = nameTokens(e.name);
    if (!bTokens.length) continue;
    const bFirst = bTokens[0];
    let score = 0;
    if (aFirst === bFirst) score = 1;
    else if (aFirst.length >= 4 && bFirst.length >= 4 && (bFirst.startsWith(aFirst) || aFirst.startsWith(bFirst))) score = 0.9;
    else {
      const bSet = new Set(bTokens);
      let overlap = 0;
      for (const t of new Set(aTokens)) if (bSet.has(t)) overlap++;
      if (overlap > 0) score = overlap / Math.min(new Set(aTokens).size, bSet.size);
    }
    if (score >= 0.5 && (!best || score > best.score)) best = { id: e.id, score };
  }
  return best?.id ?? null;
}

const toMin = (t: string | null | undefined): number | null => {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : null;
};

type SignalRow = {
  employeeId: string;
  date: Date;
  inTime: string | null;
  outTime: string | null;
  lateMinutes: number;
  earlyOutMinutes: number;
  rawStatus: string;
  shiftCode: string | null;
  remark: string | null;
  source: string;
};

async function main() {
  const commit = process.argv.includes("--commit");

  // Match against ALL employees (active + inactive) exactly like the upload route.
  const employees = await prisma.employee.findMany({ select: { id: true, name: true, empCode: true } });
  const empById = new Map(employees.map((e) => [e.id, e]));

  // Resolve shift start per (employee, cycle) — cache; upload route resolves at
  // the cycle start (the 26th of the previous month).
  const shiftStartCache = new Map<string, number | null>();
  async function shiftStartFor(empId: string, cycle: string): Promise<number | null> {
    const k = `${empId}|${cycle}`;
    if (shiftStartCache.has(k)) return shiftStartCache.get(k)!;
    const s = await resolveShiftForDate(empId, cycleWindowForMonth(cycle).start);
    const v = s ? toMin(s.startTime) : null;
    shiftStartCache.set(k, v);
    return v;
  }

  const rows: SignalRow[] = [];
  const unmatched = new Map<string, number>();
  const perEmp = new Map<string, { days: number; late: number; miss: number; eo: number }>();

  for (const f of FILES) {
    const parsed = parseAttendanceWorkbook(readFileSync(f));
    for (const r of parsed.rows) {
      const cycle = cycleMonthForDate(r.date);
      if (!CYCLES.includes(cycle)) continue;
      // No punch at all → no behavioural signal to store.
      if (!r.inTime && !r.outTime) continue;
      const empId = fuzzyMatchEmployee(r.rawName, employees);
      if (!empId) {
        unmatched.set(r.rawName, (unmatched.get(r.rawName) ?? 0) + 1);
        continue;
      }
      const dow = r.date.getUTCDay();
      const isSat = dow === 6;
      // Weekday lateness recomputed vs the resolved HR shift start (Saturday
      // lateness is already recomputed by the parser vs 09:00).
      let lateMinutes = r.lateMinutes;
      if (!isSat) {
        const shiftStart = await shiftStartFor(empId, cycle);
        const inMin = toMin(r.inTime);
        if (shiftStart != null && inMin != null) lateMinutes = Math.max(0, inMin - shiftStart);
      }
      rows.push({
        employeeId: empId,
        date: r.date,
        inTime: r.inTime,
        outTime: r.outTime,
        lateMinutes,
        earlyOutMinutes: r.earlyOutMinutes,
        rawStatus: r.status,
        shiftCode: r.shiftCode,
        remark: r.remark,
        source: SOURCE,
      });
      const agg = perEmp.get(empId) ?? { days: 0, late: 0, miss: 0, eo: 0 };
      agg.days++;
      if (lateMinutes > SHIFT_GRACE_MINUTES) agg.late++;
      if (!!r.inTime !== !!r.outTime) agg.miss++;
      if (r.earlyOutMinutes > SHIFT_GRACE_MINUTES) agg.eo++;
      perEmp.set(empId, agg);
    }
  }

  // De-dupe by (employeeId, date): the two files overlap at the 26/05 boundary
  // only across cycle files, but guard anyway — keep the last occurrence.
  const byKey = new Map<string, SignalRow>();
  for (const row of rows) byKey.set(`${row.employeeId}|${row.date.toISOString().slice(0, 10)}`, row);
  const finalRows = [...byKey.values()];

  console.log(`Parsed behavioural signals (≥1 punch, Apr–Jun): ${finalRows.length} rows for ${perEmp.size} employees`);
  console.log("\nemp                         days  late  miss  early");
  const sorted = [...perEmp.entries()].sort((a, b) => (empById.get(a[0])!.empCode).localeCompare(empById.get(b[0])!.empCode));
  for (const [id, a] of sorted) {
    const e = empById.get(id)!;
    console.log(`  ${e.empCode} ${e.name.slice(0, 22).padEnd(22)} ${String(a.days).padStart(4)}  ${String(a.late).padStart(4)}  ${String(a.miss).padStart(4)}  ${String(a.eo).padStart(4)}`);
  }
  if (unmatched.size) {
    console.log("\nUNMATCHED names (skipped — expected: departed staff not in roster):");
    for (const [n, c] of unmatched) console.log(`  ${n} (${c} days)`);
  }

  if (!commit) {
    console.log("\nDRY RUN — pass --commit to write. Nothing was changed.");
    return;
  }

  const deleted = await prisma.hrAttendanceScoreSignal.deleteMany({ where: { source: SOURCE } });
  const created = await prisma.hrAttendanceScoreSignal.createMany({ data: finalRows });
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: null,
      eventType: "attendance_score_signals_backfill",
      metadata: {
        source: SOURCE,
        files: FILES,
        cycles: CYCLES,
        deleted: deleted.count,
        inserted: created.count,
        employees: perEmp.size,
      },
    },
  });
  console.log(`\nCOMMITTED: deleted ${deleted.count} prior '${SOURCE}' rows, inserted ${created.count}.`);
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
