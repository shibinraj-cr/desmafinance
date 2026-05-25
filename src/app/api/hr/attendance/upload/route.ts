import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { parseAttendanceWorkbook, type ParsedDay } from "@/lib/hr-attendance-parser";
import { cycleMonthForDate, cycleWindowForMonth } from "@/lib/hr-data";

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
  const byCode = new Map(employees.map((e) => [e.empCode, e]));

  function fuzzyMatchEmployee(empCode: string, rawName: string): string | null {
    // 1. Exact empCode match.
    const exact = byCode.get(empCode) ?? byCode.get(empCode.padStart(4, "0"));
    if (exact) return exact.id;
    // 2. Name match — first-token exact / prefix, then token overlap.
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

  // Refresh leave balance accrual for every month covered.
  for (const m of monthSummaries) {
    const [yStr, mStr] = m.monthKey.split("-");
    await accrueMonth(+yStr, +mStr);
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

async function accrueMonth(year: number, month: number) {
  const policy =
    (await prisma.hrLeavePolicy.findFirst({ where: { isDefault: true } })) ??
    (await prisma.hrLeavePolicy.create({
      data: {
        name: "Default policy",
        monthlyAccrual: 1,
        annualEntitlement: 12,
        carryForward: true,
        isDefault: true,
      },
    }));

  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true },
  });

  for (const e of employees) {
    const existing = await prisma.hrLeaveBalance.findUnique({
      where: { employeeId_year: { employeeId: e.id, year } },
    });
    const accrued = Number(policy.monthlyAccrual) * month;
    const opening = existing?.opening ?? 0;
    const used = existing?.used ?? 0;
    const balance = Number(opening) + accrued - Number(used);
    await prisma.hrLeaveBalance.upsert({
      where: { employeeId_year: { employeeId: e.id, year } },
      update: { accrued, balance },
      create: {
        employeeId: e.id,
        year,
        opening: 0,
        accrued,
        used: 0,
        balance: accrued,
      },
    });
  }
}
