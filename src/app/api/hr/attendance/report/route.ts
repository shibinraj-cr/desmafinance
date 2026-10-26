import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, forbidden, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { attendanceWorkbook } from "@/lib/hr-attendance-report";
import { loadAttendanceReport } from "@/lib/hr-attendance-report-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // xlsx + Buffer

// GET /api/hr/attendance/report?month=YYYY-MM — the cycle's attendance sheet
// (.xlsx) in HR's monthly format: per-day in/out/P-A plus the five totals. Same
// audience as the Attendance page it is downloaded from.
export const GET = withApiHandler(async (req: Request) => {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms) throw unauthorized();
  if (!isHrUser(perms)) throw forbidden();

  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest("month must be YYYY-MM");

  const report = await loadAttendanceReport(month);
  const body = attendanceWorkbook(report);

  const filename = `Attendance-${month}.xlsx`;
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "attendance_report_downloaded",
      entityType: "HrAttendanceCycle",
      entityId: month,
      metadata: { monthKey: month, filename, employees: report.rows.length },
    },
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
