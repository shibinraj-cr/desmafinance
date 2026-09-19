import { prisma } from "@/lib/prisma";
import {
  workedMinutesForHalfDay,
  classifyWorkedDay,
  secondHalfStatusOverride,
  isSaturdayRuleExempt,
  SATURDAY_END_MIN,
  type ParsedDay,
} from "@/lib/hr-attendance-parser";
import { cycleMonthForDate, cycleWindowForMonth, SHIFT_GRACE_MINUTES } from "@/lib/hr-data";
import { recomputeAllLeaveBalances, recomputeLeaveBalance } from "@/lib/hr-leave-balance";
import { applySandwichRule } from "@/lib/hr-sandwich";
import { loadShiftTimeline, pickShiftForDate } from "@/lib/hr-shift";
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

/**
 * Cutover for the "second-half absent" rule (a morning-absent weekday graded on
 * its afternoon arrival — see `classifySecondHalfArrival`). Days BEFORE this are
 * never re-graded by the rule, protecting already-run payroll. This gate is
 * SEPARATE from `dateFloor`: the .xls upload path passes no `dateFloor` and
 * reprocesses whole historical cycles, so the rule must carry its own explicit
 * date gate. Kept distinct from `ATTENDANCE_API_CUTOVER` so moving the sync
 * window never drags this policy date. Defaults to 2026-06-26 (July cycle start);
 * overridable via env.
 */
export const SECOND_HALF_RULE_CUTOVER: Date = (() => {
  const raw = process.env.SECOND_HALF_RULE_FROM;
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
  /**
   * The date range the caller actually FETCHED, when it is narrower than the
   * salary cycle. The delete-and-replace is confined to it, so a partial pull
   * (the eTimeOffice sync's trailing lookback) can no longer wipe the rest of
   * the cycle it lands in.
   *
   * Omit on the file-upload path: a month spreadsheet covers the whole cycle,
   * so the full-window replace stays correct there.
   */
  replaceFrom?: Date | null;
  replaceTo?: Date | null;
};

/**
 * Clamp a cycle window's start to the date floor: the effective start is the
 * later of the cycle start and the floor, so the sync never reaches before it.
 * With no floor, the cycle start is used unchanged (legacy file-upload path).
 */
export function clampWindowStart(cycleStart: Date, dateFloor: Date | null | undefined): Date {
  return dateFloor && dateFloor > cycleStart ? dateFloor : cycleStart;
}

/**
 * The window the replace (delete-and-recreate) is allowed to touch for one
 * salary cycle: the cycle window, lifted to the date floor, then INTERSECTED
 * with the range the caller actually fetched.
 *
 * The intersection is the point. The ingest was written for full-month
 * spreadsheet uploads, where "replace the whole cycle" is exactly right, and
 * then reused for the API sync's 10-day trailing pull — where it deleted ~30
 * days and recreated ~10, silently destroying the rest of the cycle on every
 * tick. Callers that fetch a partial range now say so, and only that range is
 * replaced.
 *
 * Returns null when the fetched range lies entirely outside the cycle window,
 * meaning there is nothing to replace for this cycle.
 */
export function resolveReplaceWindow(args: {
  cycleStart: Date;
  cycleEnd: Date;
  dateFloor?: Date | null;
  replaceFrom?: Date | null;
  replaceTo?: Date | null;
}): { start: Date; end: Date } | null {
  const start = (() => {
    const floored = clampWindowStart(args.cycleStart, args.dateFloor);
    return args.replaceFrom && args.replaceFrom > floored ? args.replaceFrom : floored;
  })();
  const end = args.replaceTo && args.replaceTo < args.cycleEnd ? args.replaceTo : args.cycleEnd;
  return start > end ? null : { start, end };
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

    // Replace prior attendance days — idempotent re-import. The window is the
    // cycle, lifted to the floor and intersected with what this caller actually
    // fetched (see resolveReplaceWindow): a 10-day pull replaces 10 days, not
    // the whole cycle.
    //
    // Scoped to the employees present in THIS payload as well. An employee the
    // feed omits (unmatched name, device offline, a filtered export) keeps the
    // rows they already have rather than having them deleted and not restored —
    // for payroll, stale data beats missing data, and the omission is reported
    // through `unmatchedNames`.
    //
    // `locked: false` protects HR MANUAL overrides (approved regularizations,
    // decide/override actions): a locked day is never deleted here, and the
    // matching biometric row is dropped by the createMany `skipDuplicates`
    // below (unique employeeId+date). Without this, every sync tick reverted
    // approved regularizations to the raw biometric value. Sandwich flips are
    // derived (unlocked) and re-run each sync.
    const replaceWindow = resolveReplaceWindow({
      cycleStart: start,
      cycleEnd: end,
      dateFloor,
      replaceFrom: opts.replaceFrom,
      replaceTo: opts.replaceTo,
    });
    const touchedEmployeeIds = [...new Set(dayRecords.map((d) => d.employeeId))];
    if (replaceWindow && touchedEmployeeIds.length > 0) {
      await prisma.hrAttendanceDay.deleteMany({
        where: {
          date: { gte: replaceWindow.start, lte: replaceWindow.end },
          employeeId: { in: touchedEmployeeIds },
          locked: false,
        },
      });
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

  // Recompute, per employee, against the authoritative HR shift for EACH DAY now
  // that it can be resolved from the DB:
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
      await recomputeShiftDerivedDays({ employeeId, windowStart: effStart, windowEnd: end });
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

/**
 * Re-derive the shift-dependent fields for one employee across a date window:
 *
 *   (1) Weekday late-coming vs the shift start.
 *   (2) The half-day rule, with the out-time CAPPED at the shift end
 *       (weekday: the shift end; Saturday: 16:00, unless rule-exempt).
 *   (3) The second-half rule (morning-absent afternoon arrivals).
 *
 * The shift is resolved PER DAY from the assignment timeline. It used to be
 * resolved once at the window start and applied to the whole salary cycle,
 * which silently ignored any mid-cycle shift change: an employee moved from
 * Shift A (09:00-17:30) to Shift B (09:30-18:00) on, say, the 1st kept being
 * scored against A until the next cycle began on the 26th — every 09:00-09:30
 * arrival booked as late, and enough of those tip into AL half-days.
 *
 * Locked days are skipped — an HR manual override (approved regularization,
 * decide/override) owns its status and lateness.
 *
 * Returns the number of days actually changed.
 */
export async function recomputeShiftDerivedDays(args: {
  employeeId: string;
  windowStart: Date;
  windowEnd: Date;
}): Promise<number> {
  const { employeeId, windowStart, windowEnd } = args;
  if (windowEnd < windowStart) return 0;

  const timeline = await loadShiftTimeline(employeeId);
  const days = await prisma.hrAttendanceDay.findMany({
    // Skip locked days: an HR manual override owns its status/lateness and
    // must not be re-derived from the (possibly wrong) biometric punches.
    where: { employeeId, date: { gte: windowStart, lte: windowEnd }, locked: false },
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

  let changed = 0;
  for (const d of days) {
    const dow = d.date.getUTCDay();
    if (dow === 0) continue; // Sunday = week-off
    const isSat = dow === 6;
    const shift = pickShiftForDate(timeline, d.date);
    const shiftStart = shift ? toMin(shift.startTime) : null;
    const shiftEnd = shift ? toMin(shift.endTime) : null;
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

    // (3) Second-half rule: a morning-absent WEEKDAY afternoon arrival that
    // is >10 min late for the second-half start (shift start + 4h30m) — or
    // worked under the 3h floor — is a full absence (A). STATUS-ONLY: it does
    // NOT touch lateMinutes/earlyOutMinutes (so the sandwich AM/PM inference
    // stays correct). ≤10-min-late afternoons keep their duration HD. Shared
    // with the .xls upload route via secondHalfStatusOverride; gated to the
    // cutover here because the upload path passes no dateFloor.
    const secondHalfStatus = secondHalfStatusOverride(
      d.status,
      toMin(d.inTime),
      toMin(d.outTime),
      shiftStart,
      shiftEnd,
      dow,
      d.date >= SECOND_HALF_RULE_CUTOVER,
      SHIFT_GRACE_MINUTES,
    );
    if (secondHalfStatus) updates.status = secondHalfStatus;

    if (Object.keys(updates).length > 0) {
      await prisma.hrAttendanceDay.update({ where: { id: d.id }, data: updates });
      changed++;
    }
  }
  return changed;
}

/** Walk the salary-cycle keys (26th → 25th) spanned by an inclusive window. */
function cycleKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const last = cycleMonthForDate(to);
  let key = cycleMonthForDate(from);
  // Bounded: 20 years of cycles is far beyond any real window.
  for (let i = 0; i < 240; i++) {
    keys.push(key);
    if (key === last) break;
    const [y, m] = key.split("-").map(Number);
    key = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return keys;
}

export type ShiftChangeRecomputeResult = {
  cycles: {
    monthKey: string;
    updatedDays: number;
    /** Non-null when the cycle was left alone, with the reason. */
    skipped: string | null;
  }[];
};

/**
 * Re-derive stored attendance after an employee's shift timeline changes
 * (assignment created/approved/edited/deleted, or the shift swapped on the
 * employee record). Without this, corrected history stays wrong until the next
 * sync happens to re-import the cycle — and past cycles never self-heal.
 *
 * Runs `from` → today, cycle by cycle: per-day shift recompute, then the
 * sandwich rule over the FULL cycle (it needs the neighbouring days), then the
 * employee's leave balance, then any DRAFT salary run.
 *
 * A cycle whose salary run is no longer a draft is SKIPPED — approved/paid
 * payroll is never silently rewritten. HR reopens those explicitly. This also
 * keeps the recompute off closed historical cycles when HR back-dates a change.
 */
export async function recomputeAfterShiftChange(args: {
  employeeId: string;
  from: Date;
  /** Defaults to today; clamped to today (future days hold no attendance). */
  to?: Date | null;
  actorUserId?: string | null;
}): Promise<ShiftChangeRecomputeResult> {
  const { employeeId, actorUserId = null } = args;
  const n = new Date();
  const today = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  const windowEnd = args.to && args.to < today ? args.to : today;
  if (windowEnd < args.from) return { cycles: [] };

  const cycles: ShiftChangeRecomputeResult["cycles"] = [];
  const yearsTouched = new Set<number>();
  const draftKeys: string[] = [];

  for (const monthKey of cycleKeysBetween(args.from, windowEnd)) {
    const run = await prisma.hrSalaryRun.findUnique({
      where: { monthKey },
      select: { status: true },
    });
    if (run && run.status !== "draft") {
      cycles.push({ monthKey, updatedDays: 0, skipped: `salary run ${run.status}` });
      continue;
    }
    const { start, end } = cycleWindowForMonth(monthKey);
    const dayStart = start > args.from ? start : args.from;
    const dayEnd = end < windowEnd ? end : windowEnd;
    const updatedDays = await recomputeShiftDerivedDays({
      employeeId,
      windowStart: dayStart,
      windowEnd: dayEnd,
    });
    // The sandwich rule reads neighbouring days, so re-run it over the whole
    // cycle rather than just the changed slice. It is idempotent.
    await applySandwichRule({ employeeId, windowStart: start, windowEnd: end, actorUserId });
    yearsTouched.add(dayStart.getUTCFullYear());
    yearsTouched.add(dayEnd.getUTCFullYear());
    if (run) draftKeys.push(monthKey);
    cycles.push({ monthKey, updatedDays, skipped: null });
  }

  for (const y of yearsTouched) {
    await recomputeLeaveBalance(employeeId, y);
  }
  for (const monthKey of draftKeys) {
    await computeSalaryRun(monthKey, actorUserId);
  }
  return { cycles };
}
