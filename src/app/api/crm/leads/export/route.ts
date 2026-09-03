import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { leadTemperatureMeta } from "@/lib/crm";
import { countryCodeFor } from "@/lib/countries";
import {
  buildLeadWhere,
  leadFilterParamsFromQuery,
  leadSortFromQuery,
  leadOrderBy,
  leadRowInclude,
  serializeLead,
} from "@/lib/crm-leads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // xlsx + Buffer

const MAX_ROWS = 50000; // safety cap

// GET /api/crm/leads/export — download the *filtered* leads as an .xlsx.
// Accepts the same query params as the leads list, so the export always matches
// what the user is currently looking at.
export const GET = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canViewLeads) throw forbidden();

  const sp = new URL(req.url).searchParams;
  const where = buildLeadWhere(leadFilterParamsFromQuery(sp, { isBde: access.isBde, userId }));

  const rows = await prisma.lead.findMany({
    where,
    orderBy: leadOrderBy(leadSortFromQuery(sp)),
    take: MAX_ROWS,
    include: leadRowInclude,
  });

  const data = rows.map((r) => {
    const l = serializeLead(r);
    return {
      Created: new Date(l.createdAt).toLocaleString("en-IN"),
      Source: l.source?.label ?? "",
      Campaign: l.campaign ?? "",
      Status: l.status.label,
      Temperature: leadTemperatureMeta(l.temperature)?.label ?? "",
      Candidate: l.candidateName,
      Email: l.email ?? "",
      Phone: l.phone ?? "",
      "Alt Phone": l.altPhone ?? "",
      DOB: l.dob ?? "",
      Age: l.age ?? "",
      Country: l.country ?? "",
      // Derived ISO alpha-2 code (AU, IN, …); "" when the country is blank or unresolved.
      "Country Code": countryCodeFor(l.country ?? ""),
      "Study Destination": l.studyDestination ?? "",
      Service: l.service?.name ?? "",
      Qualification: l.qualification?.label ?? "",
      Consultant: l.assignedTo?.name ?? "",
      Assigned: l.assignedAt ? new Date(l.assignedAt).toLocaleString("en-IN") : "",
    };
  });

  const ws = XLSX.utils.json_to_sheet(data, {
    header: ["Created", "Source", "Campaign", "Status", "Temperature", "Candidate", "Email", "Phone", "Alt Phone", "DOB", "Age", "Country", "Country Code", "Study Destination", "Service", "Qualification", "Consultant", "Assigned"],
  });
  // Reasonable column widths.
  ws["!cols"] = [
    { wch: 20 }, { wch: 14 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 22 },
    { wch: 26 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 6 }, { wch: 16 }, { wch: 6 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="leads-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
