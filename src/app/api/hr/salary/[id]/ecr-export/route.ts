import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canViewStatutoryReports } from "@/lib/hr-rbac";
import { ECR_HEADER } from "@/lib/hr-statutory-reports";
import { getStatutoryReportData } from "@/lib/hr-statutory-reports-data";

/**
 * Monthly EPF ECR sheet (.xlsx) for a computed salary run — the layout DESMA
 * uploads through the EPFO portal flow. Figures come from the run's frozen
 * lines; see src/lib/hr-statutory-reports.ts.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canViewStatutoryReports(perms)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const data = await getStatutoryReportData(params.id);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (data.run.status !== "hr_approved" && data.run.status !== "finance_paid") {
    return NextResponse.json(
      { error: "salary run is still in draft — HR must approve before download" },
      { status: 400 },
    );
  }

  const rows: (string | number)[][] = [[...ECR_HEADER]];
  for (const r of data.ecr) {
    // UAN as text so leading zeros survive; the portal reads it either way.
    rows.push([
      r.uan,
      r.name,
      r.grossWages,
      r.epfWages,
      r.epsWage,
      r.edliWages,
      r.epfContribution,
      r.epsContribution,
      r.epfEpsDifference,
      r.ncpDays,
      r.refundOfAdvances,
    ]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const filename = `ECR-${data.run.monthKey}.xlsx`;
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "ecr_export_downloaded",
      entityType: "HrSalaryRun",
      entityId: data.run.id,
      metadata: { monthKey: data.run.monthKey, filename, members: data.ecr.length },
    },
  });

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
