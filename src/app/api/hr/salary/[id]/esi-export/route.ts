import { NextResponse } from "next/server";
import { z } from "zod";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canViewStatutoryReports } from "@/lib/hr-rbac";
import { ESI_HEADER, formatDays } from "@/lib/hr-statutory-reports";
import { getStatutoryReportData } from "@/lib/hr-statutory-reports-data";

/**
 * Monthly ESI upload (.xls — the ESIC portal only accepts the legacy Excel
 * format) for a computed salary run. Figures come from the run's frozen
 * lines. POST because zero-wage rows carry a reason code + last working day
 * that HR fills in on the Statutory Reports page before downloading; the
 * portal template stores days/wages as TEXT cells, mirrored here.
 */

const Body = z.object({
  /** Per-employee zero-day details, keyed by employeeId. */
  overrides: z
    .record(
      z.object({
        reasonCode: z.string().regex(/^\d{0,2}$/).optional(),
        lastWorkingDay: z
          .string()
          .regex(/^(\d{2}[/-]\d{2}[/-]\d{4})?$/)
          .optional(),
      }),
    )
    .optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canViewStatutoryReports(perms)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const overrides = parsed.data.overrides ?? {};

  const data = await getStatutoryReportData(params.id);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (data.run.status !== "hr_approved" && data.run.status !== "finance_paid") {
    return NextResponse.json(
      { error: "salary run is still in draft — HR must approve before download" },
      { status: 400 },
    );
  }

  const rows: (string | number)[][] = [[...ESI_HEADER]];
  for (const r of data.esi) {
    const o = r.zeroDays ? overrides[r.employeeId] : undefined;
    // IP number numeric + days/wages as text, exactly like the accepted
    // portal template.
    const ip = /^\d+$/.test(r.ipNumber) ? Number(r.ipNumber) : r.ipNumber;
    rows.push([
      ip,
      r.name,
      formatDays(r.daysPaid),
      String(r.monthlyWages),
      o?.reasonCode ?? (r.zeroDays ? "0" : ""),
      o?.lastWorkingDay ?? "",
    ]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "biff8" });

  const filename = `ESI-${data.run.monthKey}.xls`;
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId,
      eventType: "esi_export_downloaded",
      entityType: "HrSalaryRun",
      entityId: data.run.id,
      metadata: { monthKey: data.run.monthKey, filename, members: data.esi.length },
    },
  });

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": "application/vnd.ms-excel",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
