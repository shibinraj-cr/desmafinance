import { prisma } from "@/lib/prisma";
import {
  workedMinutesForHalfDay,
  classifyWorkedDay,
  isSaturdayRuleExempt,
  SATURDAY_END_MIN,
  type ParsedDay,
} from "@/lib/hr-attendance-parser";
import { cycleMonthForDate, cycleWindowForMonth } from "@/lib/hr-data";
import { recomputeAllLeaveBalances } from "@/lib/hr-leave-balance";
import { applySandwichRule } from "@/lib/hr-sandwich";
import { resolveShiftForDate } from "@/lib/hr-shift";
import { computeSalaryRun } from "@/lib/hr-salary-engine";

/**
 * Hard cutover for the eTimeOffice (biometric cloud) auto-sync.
 *
 * Attendance dated on or after this day is owned by the API sync; anything
 * BEFORE it must never be deleted, re-inserted, or re-classified by a sync. The
 * API ingestion always passes this as `dateFloor`. The cutover is the START of
 * the July salary cycle (26 Jun → 25 Jul), so the sync owns the whole July cycle
 * while the June cycle (ends 25 Jun) and every earlier .xls upload stay untouched.
 *
 * Overridable via env for a controlled change of the boundary; falls back to
 * 2026-06-26 (UTC midnight, date-only, matching how attendance dates are stored).
 */
export const ATTENDANCE_API_CUTOVER: Date = (() => {
  const raw = process.env.ETIMEOFFICE_SYNC_FROM;
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return new Date(Date.UTC(2026, 5, 26)); // 2026-06-26
})();

export type IngestSource = "file" | "etimeoffice";

export type MonthSummary = {
  monthKey: string;
  uploadId: string;
  inserted: number;
  unmatched: number;
  unmatchedNames: string[];
};

export type SalaryRunSummary = {
  monthKey: string;
  recomputed: boolean;
  status: string | null;
  warnings?: string[];
};

export type IngestResult = {
  months: MonthSummary[];
  salaryRuns: SalaryRunSummary[];
  unmatchedNames: string[];
  warnings: string[];
  /** ISO date range actually ingested (after any dateFloor clamp). */
  rangeStart: string | null;
  rangeEnd: string | null;
};

export type IngestOptions = {
  /** Stored on the HrAttendanceUpload record for provenance. */
  filename: string | null;
  /** Actor for audit + upload attribution. */
  userId: string | null;
  source: IngestSource;
  /** Warnings surfaced by the parser/adapter, folded into the audit log. */
  warnings?: string[];
  /**
   * When set, NOTHING dated before this day is deleted, inserted, or mutated.
   * Used by the eTimeOffice sync (ATTENDANCE_API_CUTOVER) so historical .xls
   * data is never disturbed. Omit for the file-upload path (full-window
   * replace, the legacy behaviour).
   */
  dateFloor?: Date | null;
};

/**
 * Clamp a cycle window's start to the date floor: the effective start is the
 * later of the cycle start and the floor, so the sync never reaches before it.
 * With no floor, the cycle start is used unchanged (legacy file-upload path).
 */
export function clampWindowStart(cycleStart: Date, dateFloor: Date | null | undefined): Date {
  return dateFloor && dateFloor > cycleStart ? dateFloor : cycleStart;
}

/** Drop any row dated strictly before the floor (never inserted or mutated). */
export function filterRowsFromFloor<T extends { date: Date }>(
  rows: T[],
  dateFloor: Date | null | undefined,
): T[] {
  return dateFloor ? rows.filter((r) => r.date >= dateFloor) : rows;
}

function nameTokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[.,()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

const toMin = (t: string | null) => {
  if (!t) return null;
  const mm = t.match(/^(\d{1,2}):(\d{2})$/);
  return mm ? +mm[1] * 60 + +mm[2] : null;
};

/**
 * Ingest parsed attendance day rows (from either a biometric .xls upload or the
 * eTimeOffice API). This is the single authoritative pipeline: employee
 * matching → per-cycle replace → holiday/late/half-day recompute → sandwich
 * rule → leave-balance refresh → draft salary recompute.
 *
 * `opts.dateFloor` clamps every destructive/mutating step so the API sync can
 * add new days without touching the historical uploads that precede the floor.
 */
export async function ingestParsedAttendance(
  rows: ParsedDay[],
  opts: IngestOptions,
): Promise<IngestResult> {
  const { filename, userId, source } = opts;
  const dateFloor = opts.dateFloor ?? null;
  const warnings = [...(opts.warnings ?? [])];

  // Drop anything before the floor up-front so it can never be inserted.
  const eligibleRows = filterRowsFromFloor(rows, dateFloor);

  const employees = await prisma.employee.findMany({
    select: { id: true, empCode: true, name: true },
  });

  /**
   * Match a biometric row to an HR master employee. The biometric system uses
   * ITS OWN empCodes which don't align with our master (the file has Vishnu at
   * 0001 while our master has Greeshma at 0001). So we MUST match by name, never
   * by empCode — even an exact empCode hit would corrupt data.
   *
   * Strategy:
   *   1. first-token exact match  → score 1.0
   *   2. first-token prefix match (≥4 chars) → 0.9
   *   3. any-token overlap → overlap / min(tokenCount)
   *   threshold ≥ 0.5
   */
  function fuzzyMatchEmployee(_empCode: string, rawName: string): string | null {
    const aTokens = nameTokens(rawName);
    if (aTokens.length === 0) return null;
    const aFirst = aTokens[0];
    let best: { id: string; score: number } | null = null;
    for (const e of employees) {
      const bTokens = nameTokens(e.name);
      if (bTokens.length === 0) continue;
      const bFirst = bTokens[0];
      let score = 0;
      if (aFirst === bFirst) score = 1;
      else if (aFirst.length >= 4 && bFirst.length >= 4 && (bFirst.startsWith(aFirst) || aFirst.startsWith(bFirst)))
        score = 0.9;
      else {
        const aSet = new Set(aTokens);
        const bSet = new Set(bTokens);
        let overlap = 0;
        for (const t of aSet) if (bSet.has(t)) overlap++;
        if (overlap > 0) score = overlap / Math.min(aSet.size, bSet.size);
      }
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { id: e.id, score };
      }
    }
    return best?.id ?? null;
  }

  // Bucket rows by salary cycle month (26th prev → 25th current).
  const byMonth = new Map<string, ParsedDay[]>();
  for (const r of eligibleRows) {
    const key = cycleMonthForDate(r.date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(r);
  }

  const monthSummaries: MonthSummary[] = [];
  const allUnmatchedNames = new Set<string>();
  let rangeStart: Date | null = null;
  let rangeEnd: Date | null = null;

  for (const [monthKey, rowsForMonth] of byMonth) {
    const { start, end } = cycleWindowForMonth(monthKey);
    // Clamp the replace window to the floor: never delete/replace before it.
    const effStart = clampWindowStart(start, dateFloor);

    // Replace any prior attendance days for this (clamped) window — idempotent
    // re-import. With a floor, rows dated before it survive untouched.
    await prisma.hrAttendanceDay.deleteMany({
      where: { date: { gte: effStart, lte: end } },
    });

    // Pull holidays in the window so we can reclassify shift=X / no-punch rows
    // that fall on a known holiday → HL instead of A or WO.
    const holidayRows = await prisma.holiday.findMany({
      where: { date: { gte: effStart, lte: end } },
      select: { date: true },
    });
    const holidaySet = new Set(holidayRows.map((h) => h.date.toISOString().slice(0, 10)));

    const upload = await prisma.hrAttendanceUpload.create({
      data: {
        filename,
        monthKey,
        rowCount: rowsForMonth.length,
        uploadedById: userId ?? null,
      },
    });

    const resolveCache = new Map<string, string | null>();
    let inserted = 0;
    let unmatched = 0;
    const unmatchedNames = new Set<string>();

    const dayRecords: {
      uploadId: string;
      employeeId: string;
      date: Date;
      shiftCode: string | null;
      inTime: string | null;
      outTime: string | null;
      workMinutes: number;
      otMinutes: number;
      lateMinutes: number;
      earlyOutMinutes: number;
      status: string;
      rawStatus: string;
      remark: string | null;
      rawName: string;
    }[] = [];

    for (const r of rowsForMonth) {
      const cacheKey = `${r.empCode}|${r.rawName}`;
      let empId = resolveCache.get(cacheKey);
      if (empId === undefined) {
        empId = fuzzyMatchEmployee(r.empCode, r.rawName);
        resolveCache.set(cacheKey, empId);
      }
      if (!empId) {
        unmatched++;
        unmatchedNames.add(r.rawName || r.empCode);
        allUnmatchedNames.add(r.rawName || r.empCode);
        continue;
      }
      // Smart-fix: some biometric exports tag Sundays / holidays as status="A"
      // because the off-day shift wasn't configured per employee. If we see
      // shift=X with no punch and zero work, the employee couldn't possibly have
      // been "absent" in the LOP sense — reclassify as HL (published holiday) or
      // WO (Sunday). Genuine missed punches stay as A.
      let finalStatus = r.status;
      const isoDate = r.date.toISOString().slice(0, 10);
      const isNonWorkShift = r.shiftCode === "X" || r.shiftCode === null;
      const noPunch = !r.inTime && !r.outTime && r.workMinutes === 0;
      if (r.status === "A" && isNonWorkShift && noPunch) {
        if (holidaySet.has(isoDate)) finalStatus = "HL";
        else if (r.date.getUTCDay() === 0) finalStatus = "WO";
      }

      dayRecords.push({
        uploadId: upload.id,
        employeeId: empId,
        date: r.date,
        shiftCode: r.shiftCode,
        inTime: r.inTime,
        outTime: r.outTime,
        workMinutes: r.workMinutes,
        otMinutes: r.otMinutes,
        lateMinutes: r.lateMinutes,
        earlyOutMinutes: r.earlyOutMinutes,
        status: finalStatus,
        rawStatus: r.status,
        remark: r.remark,
        rawName: r.rawName,
      });
      inserted++;

      if (!rangeStart || r.date < rangeStart) rangeStart = r.date;
      if (!rangeEnd || r.date > rangeEnd) rangeEnd = r.date;
    }

    if (dayRecords.length > 0) {
      await prisma.hrAttendanceDay.createMany({ data: dayRecords, skipDuplicates: true });
    }

    monthSummaries.push({
      monthKey,
      uploadId: upload.id,
      inserted,
      unmatched,
      unmatchedNames: [...unmatchedNames],
    });
  }

  // Audit log.
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "attendance_imported",
      metadata: {
        source,
        filename,
        dateFloor: dateFloor ? dateFloor.toISOString().slice(0, 10) : null,
        rangeStart: rangeStart?.toISOString() ?? null,
        rangeEnd: rangeEnd?.toISOString() ?? null,
        months: monthSummaries.map((m) => ({
          monthKey: m.monthKey,
          inserted: m.inserted,
          unmatched: m.unmatched,
        })),
        unmatchedNames: [...allUnmatchedNames],
        warnings: warnings.slice(0, 50),
      },
    },
  });

  // Recompute, per employee, against the authoritative HR shift now that it can
  // be resolved from the DB:
  //   (1) Weekday late-coming vs the HR shift start.
  //   (2) The half-day rule with the out-time CAPPED at the shift end.
  // Every query here is clamped to `effStart` so pre-floor rows are never read
  // or mutated.
  for (const m of monthSummaries) {
    const { start, end } = cycleWindowForMonth(m.monthKey);
    const effStart = clampWindowStart(start, dateFloor);
    const empRows = await prisma.hrAttendanceDay.findMany({
      where: { date: { gte: effStart, lte: end } },
      select: { employeeId: true },
      distinct: ["employeeId"],
    });
    for (const { employeeId } of empRows) {
      const shift = await resolveShiftForDate(employeeId, effStart);
      const shiftStart = shift ? toMin(shift.startTime) : null;
      const shiftEnd = shift ? toMin(shift.endTime) : null;
      const days = await prisma.hrAttendanceDay.findMany({
        where: { employeeId, date: { gte: effStart, lte: end } },
        select: {
          id: true,
          date: true,
          inTime: true,
          outTime: true,
          lateMinutes: true,
          status: true,
          rawName: true,
        },
      });
      for (const d of days) {
        const dow = d.date.getUTCDay();
        if (dow === 0) continue; // Sunday = week-off
        const isSat = dow === 6;
        const updates: { lateMinutes?: number; status?: string } = {};

        // (1) Weekday late-coming (Saturday handled in the parser/adapter).
        if (!isSat && shiftStart != null) {
          const inMin = toMin(d.inTime);
          if (inMin != null) {
            const newLate = Math.max(0, inMin - shiftStart);
            if (newLate !== (d.lateMinutes ?? 0)) updates.lateMinutes = newLate;
          }
        }

        // (2) Half-day / absence recompute from the capped punch duration.
        if ((d.status === "P" || d.status === "HD") && d.inTime && d.outTime) {
          const cap = isSat
            ? isSaturdayRuleExempt(d.rawName ?? "")
              ? null
              : SATURDAY_END_MIN
            : shiftEnd;
          const worked = workedMinutesForHalfDay(d.inTime, d.outTime, cap);
          if (worked != null) {
            const newStatus = classifyWorkedDay(worked, isSat);
            if (newStatus !== d.status) updates.status = newStatus;
          }
        }

        if (Object.keys(updates).length > 0) {
          await prisma.hrAttendanceDay.update({ where: { id: d.id }, data: updates });
        }
      }
    }
  }

  // Apply the sandwich rule for every employee in each imported cycle. Clamped
  // to `effStart` so a sync never re-flips (or reverts) pre-floor days.
  for (const m of monthSummaries) {
    const { start, end } = cycleWindowForMonth(m.monthKey);
    const effStart = clampWindowStart(start, dateFloor);
    const empRows = await prisma.hrAttendanceDay.findMany({
      where: { date: { gte: effStart, lte: end } },
      select: { employeeId: true },
      distinct: ["employeeId"],
    });
    for (const { employeeId } of empRows) {
      await applySandwichRule({ employeeId, windowStart: effStart, windowEnd: end, actorUserId: userId ?? null });
    }
  }

  // Refresh canonical leave balances for every calendar year the import touches.
  // This is a pure recompute that READS attendance (incl. pre-floor days, which
  // is correct — the yearly balance must include them) but writes only leave
  // balance/ledger rows, never attendance days.
  const yearsTouched = new Set<number>();
  for (const m of monthSummaries) {
    const { start, end } = cycleWindowForMonth(m.monthKey);
    const effStart = clampWindowStart(start, dateFloor);
    yearsTouched.add(effStart.getUTCFullYear());
    yearsTouched.add(end.getUTCFullYear());
  }
  for (const y of yearsTouched) {
    await recomputeAllLeaveBalances(y);
  }

  // Refresh any DRAFT salary run for an imported cycle. Approved runs stay
  // locked; HR reopens/recomputes those explicitly.
  const salaryRuns: SalaryRunSummary[] = [];
  for (const m of monthSummaries) {
    const run = await prisma.hrSalaryRun.findUnique({
      where: { monthKey: m.monthKey },
      select: { status: true },
    });
    if (!run) {
      salaryRuns.push({ monthKey: m.monthKey, recomputed: false, status: null });
      continue;
    }
    if (run.status !== "draft") {
      salaryRuns.push({ monthKey: m.monthKey, recomputed: false, status: run.status });
      continue;
    }
    const res = await computeSalaryRun(m.monthKey, userId ?? null);
    salaryRuns.push({
      monthKey: m.monthKey,
      recomputed: true,
      status: "draft",
      warnings: res.warnings.slice(0, 50),
    });
  }

  return {
    months: monthSummaries,
    salaryRuns,
    unmatchedNames: [...allUnmatchedNames],
    warnings,
    rangeStart: rangeStart?.toISOString().slice(0, 10) ?? null,
    rangeEnd: rangeEnd?.toISOString().slice(0, 10) ?? null,
  };
}
