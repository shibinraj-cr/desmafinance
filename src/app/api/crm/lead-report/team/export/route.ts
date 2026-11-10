import * as XLSX from "xlsx";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { resolveReportDay } from "@/lib/crm-daily-report";
import { getLeadReportAccess, getTeamLeadReport } from "@/lib/crm-lead-report-data";
import { teamReportSheets } from "@/lib/crm-lead-report-export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The team daily lead report for one IST day as an .xlsx (By BDE, By source, Missed leads, Handovers). */
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getLeadReportAccess(userId, perms);
  if (!access.canViewOthers) throw forbidden();
  const day = resolveReportDay(new URL(req.url).searchParams.get("date") ?? undefined);

  const wb = XLSX.utils.book_new();
  for (const sheet of teamReportSheets(await getTeamLeadReport(day))) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows);
    ws["!cols"] = Object.keys(sheet.rows[0] ?? {}).map((k) => ({ wch: Math.max(10, k.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="daily-lead-report-${day}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
