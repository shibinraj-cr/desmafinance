import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { parseAttendanceWorkbook } from "@/lib/hr-attendance-parser";
import { normaliseAttendanceStatus, parseMonthKey } from "@/lib/hr-data";

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  const monthKey = String(form.get("monthKey") ?? "");
  if (!(file instanceof Blob) || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return NextResponse.json({ error: "invalid file or monthKey" }, { status: 400 });
  }
  const filename = (file as unknown as { name?: string }).name;

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseAttendanceWorkbook(buf);

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "no employee blocks detected in workbook", warnings: parsed.warnings },
      { status: 400 },
    );
  }

  const { year, month } = parseMonthKey(monthKey);

  const allEmployees = await prisma.employee.findMany({ select: { id: true, empCode: true } });
  const byCode = new Map(allEmployees.map((e) => [e.empCode, e.id]));

  const upload = await prisma.hrAttendanceUpload.create({
    data: {
      filename: filename ?? null,
      monthKey,
      rowCount: parsed.rows.length,
      uploadedById: userId ?? null,
    },
  });

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  await prisma.hrAttendanceDay.deleteMany({
    where: { date: { gte: start, lte: end } },
  });

  let inserted = 0;
  let unmatched = 0;
  const unmatchedRows: { empCode: string; rawName: string }[] = [];

  for (const r of parsed.rows) {
    let employeeId = byCode.get(r.empCode);
    if (!employeeId) {
      const padded = r.empCode.padStart(4, "0");
      employeeId = byCode.get(padded);
    }
    if (!employeeId) {
      unmatched++;
      unmatchedRows.push({ empCode: r.empCode, rawName: r.rawName });
      continue;
    }

    const records = r.days.map((d) => ({
      uploadId: upload.id,
      employeeId: employeeId!,
      date: new Date(Date.UTC(year, month - 1, d.day)),
      inTime: d.inTime,
      outTime: d.outTime,
      workMinutes: d.workMinutes,
      breakMinutes: d.breakMinutes,
      otMinutes: d.otMinutes,
      status: normaliseAttendanceStatus(d.status),
      rawName: null,
    }));

    if (records.length === 0) continue;
    await prisma.hrAttendanceDay.createMany({ data: records, skipDuplicates: true });
    inserted += records.length;
  }

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "attendance_imported",
      entityType: "HrAttendanceUpload",
      entityId: upload.id,
      metadata: {
        monthKey,
        rowCount: parsed.rows.length,
        inserted,
        unmatched,
        unmatchedRows: unmatchedRows.slice(0, 50),
        warnings: parsed.warnings.slice(0, 50),
      },
    },
  });

  await accrueMonth(year, month);

  return NextResponse.json({
    uploadId: upload.id,
    inserted,
    unmatched,
    unmatchedRows,
    warnings: parsed.warnings,
  });
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
