import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { getMonthlyMatrix } from "@/lib/lead-pulse-metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/marketing/lead-pulse/monthly-report/export?year=2026&month=5&format=xlsx
 *
 * Generates an XLSX of the monthly funnel matrix that mirrors the on-
 * screen layout. PDF is approximated by an XLSX print-friendly variant
 * for v1 — supervisors can "Save as PDF" from Excel.
 */
export async function GET(req: NextRequest) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  const sourceCode = url.searchParams.get("source") || null;
  const region = url.searchParams.get("region") || null;
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  const matrix = await getMonthlyMatrix({ year, month, sourceCode, region });

  // Build the tabular layout with two header rows like the on-screen one.
  const sources = matrix.sources;
  const header1: (string | number)[] = ["BDE"];
  for (const s of sources) {
    header1.push(s.label, "", "");
  }
  header1.push("TOTAL", "", "");

  const header2: (string | number)[] = [""];
  for (let i = 0; i < sources.length; i++) header2.push("LEADS", "WON", "%");
  header2.push("LEADS", "WON", "%");

  const aoa: (string | number | null)[][] = [header1, header2];

  function pushRow(label: string, perSource: Map<string, { leads: number; won: number; conversionPct: number | null }>, total: { leads: number; won: number; conversionPct: number | null }) {
    const row: (string | number | null)[] = [label];
    for (const s of sources) {
      const c = perSource.get(s.code);
      row.push(c?.leads ?? 0, c?.won ?? 0, c?.conversionPct ?? null);
    }
    row.push(total.leads, total.won, total.conversionPct);
    aoa.push(row);
  }

  aoa.push([`L1 TEAM`]);
  for (const r of matrix.l1Rows) pushRow(r.displayName, r.perSource, r.total);
  pushRow("Subtotal L1", matrix.l1Subtotal.perSource, matrix.l1Subtotal.total);

  aoa.push([`L2 TEAM`]);
  for (const r of matrix.l2Rows) pushRow(r.displayName, r.perSource, r.total);
  pushRow("Subtotal L2", matrix.l2Subtotal.perSource, matrix.l2Subtotal.total);

  pushRow("GLOBAL TOTALS", matrix.globalTotal.perSource, matrix.globalTotal.total);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Merge each source's 3-column group on the top header row
  const merges: XLSX.Range[] = [];
  for (let i = 0; i < sources.length; i++) {
    const c = 1 + i * 3;
    merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 2 } });
  }
  // TOTAL group
  const totalC = 1 + sources.length * 3;
  merges.push({ s: { r: 0, c: totalC }, e: { r: 0, c: totalC + 2 } });
  ws["!merges"] = merges;

  // Column widths
  ws["!cols"] = [
    { wch: 28 },
    ...Array(sources.length * 3 + 3).fill({ wch: 9 }),
  ];

  const wb = XLSX.utils.book_new();
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long" });
  XLSX.utils.book_append_sheet(wb, ws, `${monthName} ${year}`);

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new Uint8Array(buf);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="lead-pulse-${year}-${String(month).padStart(2, "0")}.xlsx"`,
    },
  });
}
