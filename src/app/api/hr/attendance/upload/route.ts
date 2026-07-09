import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import {
  parseAttendanceWorkbook,
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

/**
 * Upload a biometric attendance .xls / .xlsx (any format supported by
 * `parseAttendanceWorkbook`). The file may span multiple months — we
 * create one HrAttendanceUpload per month covered and insert the
 * matching day rows under it.
 *
 * Employees are matched by name (case-insensitive, first-token / token-
 * overlap). The biometric system uses its own empCodes that may not
 * align with our master, so name is the reliable key.
 */
export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  const filename = (file as unknown as { name?: string }).name ?? null;

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseAttendanceWorkbook(buf);

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "no day rows detected in workbook", warnings: parsed.warnings },
      { status: 400 },
    );
  }

  const employees = await prisma.employee.findMany({
    select: { id: true, empCode: true, name: true },
  });

  /**
   * Match a biometric row to an HR master employee. The biometric system
   * uses ITS OWN empCodes which don't align with our master (the file
   * has Vishnu at 0001 while our master has Greeshma at 0001). So we
   * MUST match by name, never by empCode — even an exact empCode hit
   * would corrupt data.
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
  for (const r of parsed.rows) {
    const key = cycleMonthForDate(r.date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(r);
  }

  const monthSummaries: {
    monthKey: string;
    uploadId: string;
    inserted: number;
    unmatched: number;
    unmatchedNames: string[];
  }[] = [];
  const allUnmatchedNames = new Set<string>();

  for (const [monthKey, rowsForMonth] of byMonth) {
    const { start, end } = cycleWindowForMonth(monthKey);

    // Replace any prior attendance days for this cycle window (idempotent re-import).
    await prisma.hrAttendanceDay.deleteMany({
      where: { date: { gte: start, lte: end } },
    });

    // Pull holidays in this window so we can reclassify shift=X / no-punch
    // rows that fall on a known holiday → HL instead of A or WO.
    const holidayRows = await prisma.holiday.findMany({
      where: { date: { gte: start, lte: end } },
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

    // Resolve employee ids per unique (empCode, name) once.
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
      // Smart-fix: some biometric exports tag Sundays / holidays as
      // status="A" because the off-day shift wasn't configured per
      // employee. If we see shift=X with no punch and zero work, the
      // employee couldn't possibly have been "absent" in the LOP sense
      // — reclassify as HL (if a published holiday) or WO (Sunday).
      // Genuine missed punches stay as A.
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
        filename,
        rangeStart: parsed.rangeStart?.toISOString() ?? null,
        rangeEnd: parsed.rangeEnd?.toISOString() ?? null,
        months: monthSummaries.map((m) => ({
          monthKey: m.monthKey,
          inserted: m.inserted,
          unmatched: m.unmatched,
        })),
        unmatchedNames: [...allUnmatchedNames],
        warnings: parsed.warnings.slice(0, 50),
      },
    },
  });

  // Recompute, per employee, against the authoritative HR shift now that it can
  // be resolved from the DB:
  //   (1) Weekday late-coming vs the HR shift start. The biometric file computes
  //       "Late In" against its own shift config, which bakes in extra grace and
  //       understates lateness (e.g. a 09:15 punch shown as 10 min late, then
  //       masked again by our 10-min grace). Measuring from the shift start
  //       (Shift A 09:00 / B 09:30) and letting computeLateTags apply the single
  //       grace fixes it. Saturday lateness is already recomputed in the parser.
  //   (2) The half-day rule with the out-time CAPPED at the shift end (weekday:
  //       the resolved shift end; Saturday: 16:00) — overtime past shift end must
  //       not count toward a full day. The parser only had the uncapped span, so
  //       this is the authoritative pass. Only worked days (both punches, current
  //       status P/HD) are eligible; decided/off codes and missing-punch HDs are
  //       left untouched.
  const toMin = (t: string | null) => {
    if (!t) return null;
    const mm = t.match(/^(\d{1,2}):(\d{2})$/);
    return mm ? +mm[1] * 60 + +mm[2] : null;
  };
  for (const m of monthSummaries) {
    const { start, end } = cycleWindowForMonth(m.monthKey);
    const empRows = await prisma.hrAttendanceDay.findMany({
      where: { date: { gte: start, lte: end } },
      select: { employeeId: true },
      distinct: ["employeeId"],
    });
    for (const { employeeId } of empRows) {
      const shift = await resolveShiftForDate(employeeId, start);
      const shiftStart = shift ? toMin(shift.startTime) : null;
      const shiftEnd = shift ? toMin(shift.endTime) : null;
      const days = await prisma.hrAttendanceDay.findMany({
        where: { employeeId, date: { gte: start, lte: end } },
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

        // (1) Weekday late-coming (Saturday handled in the parser).
        if (!isSat && shiftStart != null) {
          const inMin = toMin(d.inTime);
          if (inMin != null) {
            const newLate = Math.max(0, inMin - shiftStart);
            if (newLate !== (d.lateMinutes ?? 0)) updates.lateMinutes = newLate;
          }
        }

        // (2) Half-day / absence recompute from the capped punch duration.
        // Saturday caps at 16:00; exempt employees (e.g. Nithya) work a different
        // Saturday schedule, so leave their out-time uncapped. A capped span under
        // 3h is a full absence (A) — the cap can push a P/HD below the floor when
        // the employee only punched in late in the day.
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

  // Apply the sandwich rule for every employee in each imported cycle: a
  // week-off / holiday flanked by leave (absence/LV/HD) on both sides becomes
  // unpaid (A). This previously ran only via the (now-removed) Leave Review
  // decide route, so a fresh upload left it unapplied. applySandwichRule is
  // self-reconciling, so re-uploads converge rather than double-flip. Runs after
  // the late recompute so the HD half-day inference reads corrected lateness.
  for (const m of monthSummaries) {
    const { start, end } = cycleWindowForMonth(m.monthKey);
    const empRows = await prisma.hrAttendanceDay.findMany({
      where: { date: { gte: start, lte: end } },
      select: { employeeId: true },
      distinct: ["employeeId"],
    });
    for (const { employeeId } of empRows) {
      await applySandwichRule({ employeeId, windowStart: start, windowEnd: end, actorUserId: userId ?? null });
    }
  }

  // Refresh the canonical leave balances for every calendar year the import
  // touches (a cycle straddles the year boundary, so cover both ends). This
  // folds in per-employee eligibility accrual *and* the freshly imported
  // reviewed/decided leave (LV/HD) in one pass. Runs AFTER the sandwich pass so
  // any newly-flipped A days are reflected in the balances.
  const yearsTouched = new Set<number>();
  for (const m of monthSummaries) {
    const { start, end } = cycleWindowForMonth(m.monthKey);
    yearsTouched.add(start.getUTCFullYear());
    yearsTouched.add(end.getUTCFullYear());
  }
  for (const y of yearsTouched) {
    await recomputeAllLeaveBalances(y);
  }

  return NextResponse.json({
    months: monthSummaries,
    rangeStart: parsed.rangeStart?.toISOString().slice(0, 10) ?? null,
    rangeEnd: parsed.rangeEnd?.toISOString().slice(0, 10) ?? null,
    unmatchedNames: [...allUnmatchedNames],
    warnings: parsed.warnings,
  });
}

function nameTokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[.,()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}
