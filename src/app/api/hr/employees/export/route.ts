import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { loadEmployees } from "@/lib/hr-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // xlsx + Buffer

function fmtDate(d: Date | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

// GET /api/hr/employees/export — download the employee master as an .xlsx.
// Honors the same `q` search and `inactive` toggle as the on-screen list so the
// export always matches what the user is currently looking at.
export const GET = withApiHandler(async (req: Request) => {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) throw unauthorized();
  if (!isHrUser(perms)) throw forbidden();

  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") || "").trim().toLowerCase();
  const includeInactive = sp.get("inactive") === "1";

  const employees = await loadEmployees();
  const filtered = employees.filter((e) => {
    if (!includeInactive && !e.active) return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      e.empCode.toLowerCase().includes(q) ||
      (e.department ?? "").toLowerCase().includes(q) ||
      (e.designation ?? "").toLowerCase().includes(q)
    );
  });

  const data = filtered.map((e) => ({
    "Emp Code": e.empCode,
    Name: e.name,
    Designation: e.designation ?? "",
    Department: e.department ?? "",
    Shift: e.shiftName ?? e.shiftCode ?? "",
    "Join Date": fmtDate(e.joinDate),
    Email: e.email ?? "",
    "Official Email": e.officialEmail ?? "",
    Phone: e.phone ?? "",
    Bank: e.bankName ?? "",
    "Account No": e.accountNumber ?? "",
    IFSC: e.ifsc ?? "",
    Branch: e.branch ?? "",
    "Late Coming Eligibility": e.halfHourConcession ? "Yes" : "No",
    "Salary Structure": e.hasCurrentStructure ? "Set" : "Missing",
    Status: e.active ? "Active" : "Inactive",
  }));

  const header = [
    "Emp Code", "Name", "Designation", "Department", "Shift", "Join Date",
    "Email", "Official Email", "Phone", "Bank", "Account No", "IFSC", "Branch",
    "Late Coming Eligibility", "Salary Structure", "Status",
  ];
  const ws = XLSX.utils.json_to_sheet(data, { header });
  ws["!cols"] = [
    { wch: 10 }, { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 22 }, { wch: 12 },
    { wch: 26 }, { wch: 26 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 16 },
    { wch: 12 }, { wch: 16 }, { wch: 10 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Employees");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="employees-${stamp}.xlsx"`,
      "cache-control": "no-store",
    },
  });
});
