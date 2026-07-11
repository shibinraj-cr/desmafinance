import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { phoneMatchKeys } from "@/lib/crm";
import {
  parseMetaWorkbook,
  collectLookupKeys,
  reconcileRows,
  parseSinceDate,
  type MetaLeadRow,
  type ReconcileBuckets,
} from "@/lib/crm-meta-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // xlsx + Buffer need the Node runtime

// The page grant that gates this tool. System admins pass canSeePage() by
// default; the "Marketing Admin" role is granted this href explicitly.
const META_RECONCILE_PAGE = "/crm/meta-reconcile";

// Above this many missing rows the client table gets heavy; we still return them
// all (completeness) but warn so the user can narrow the date.
const LARGE_MISSING_WARN = 5000;

type SheetReport = {
  sheetName: string;
  mapping: Record<string, string>;
  dataRowCount: number;
  skipped: boolean;
  skipReason?: string;
  isLikelyNonLead: boolean;
  warnings: string[];
  counts: { missing: number; matchedInCrm: number; withinFileDupes: number; beforeSince: number; noDate: number; unmatchable: number };
};

// POST /api/crm/meta-reconcile — parse a Meta export + report which in-window
// leads are missing from the CRM. Read-only: NOTHING is written.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canSeePage(perms, META_RECONCILE_PAGE)) throw forbidden();

  const formData = await req.formData().catch(() => null);
  if (!formData) throw badRequest("Could not read the upload", "bad_form");
  const file = formData.get("file");
  if (!file || typeof file === "string") throw badRequest("No file provided", "no_file");
  const sinceRaw = String(formData.get("sinceDate") ?? "").trim();
  const sinceStart = parseSinceDate(sinceRaw);
  if (!sinceStart) throw badRequest("Pick a valid reconciliation date (YYYY-MM-DD).", "bad_date");

  const buf = Buffer.from(await (file as File).arrayBuffer());
  let parsed;
  try {
    parsed = parseMetaWorkbook(buf);
  } catch {
    throw badRequest("Could not read the spreadsheet. Upload the original .xlsx (not a CSV re-export).", "bad_workbook");
  }
  const leadSheets = parsed.sheets.filter((s) => !s.skipped);
  const allRows: MetaLeadRow[] = leadSheets.flatMap((s) => s.rows);
  if (allRows.length === 0) {
    throw badRequest("No lead rows found in any sheet. Check the file has Name / Phone / Email columns.", "no_rows");
  }

  // Batched CRM lookup: gather the in-window match keys, then a handful of `IN`
  // queries instead of one lookup per row (files run to tens of thousands).
  const { emailKeys, phoneKeys } = collectLookupKeys(allRows, sinceStart);
  const existingEmail = new Set<string>();
  const existingPhone = new Set<string>();
  const CHUNK = 2000;
  for (let i = 0; i < emailKeys.length; i += CHUNK) {
    const part = emailKeys.slice(i, i + CHUNK);
    const found = await prisma.lead.findMany({ where: { emailKey: { in: part } }, select: { emailKey: true } });
    for (const f of found) if (f.emailKey) existingEmail.add(f.emailKey);
  }
  for (let i = 0; i < phoneKeys.length; i += CHUNK) {
    const part = phoneKeys.slice(i, i + CHUNK);
    const found = await prisma.lead.findMany({
      where: { OR: [{ phoneE164: { in: part } }, { altPhoneE164: { in: part } }] },
      select: { phoneE164: true, altPhoneE164: true },
    });
    for (const f of found) for (const k of phoneMatchKeys(f.phoneE164, f.altPhoneE164)) existingPhone.add(k);
  }

  const buckets = reconcileRows(allRows, sinceStart, { emailKeys: existingEmail, phoneKeys: existingPhone });

  // Per-sheet tally so the UI can show a campaign-by-campaign breakdown.
  const bySheet = new Map<string, SheetReport>();
  for (const s of parsed.sheets) {
    bySheet.set(s.sheetName, {
      sheetName: s.sheetName,
      mapping: s.mapping,
      dataRowCount: s.dataRowCount,
      skipped: s.skipped,
      skipReason: s.skipReason,
      isLikelyNonLead: s.isLikelyNonLead,
      warnings: s.warnings,
      counts: { missing: 0, matchedInCrm: 0, withinFileDupes: 0, beforeSince: 0, noDate: 0, unmatchable: 0 },
    });
  }
  const tally = (rows: MetaLeadRow[], key: keyof SheetReport["counts"]) => {
    for (const r of rows) {
      const rep = bySheet.get(r.sheetName);
      if (rep) rep.counts[key]++;
    }
  };
  (Object.keys(buckets) as (keyof ReconcileBuckets)[]).forEach((k) => tally(buckets[k], k as keyof SheetReport["counts"]));

  const totals = {
    dataRows: parsed.sheets.reduce((a, s) => a + s.dataRowCount, 0),
    missing: buckets.missing.length,
    matchedInCrm: buckets.matchedInCrm.length,
    withinFileDupes: buckets.withinFileDupes.length,
    beforeSince: buckets.beforeSince.length,
    noDate: buckets.noDate.length,
    unmatchable: buckets.unmatchable.length,
  };

  const warnings: string[] = [];
  const skippedSheets = parsed.sheets.filter((s) => s.skipped);
  if (skippedSheets.length) {
    warnings.push(`Skipped ${skippedSheets.length} non-lead sheet(s): ${skippedSheets.map((s) => `“${s.sheetName}”`).join(", ")}.`);
  }
  if (totals.missing > LARGE_MISSING_WARN) {
    warnings.push(`${totals.missing.toLocaleString("en-IN")} missing leads — the table may be slow. Consider a later date to narrow it.`);
  }

  return NextResponse.json({
    sinceDate: sinceRaw,
    fileName: typeof (file as File).name === "string" ? (file as File).name : null,
    totals,
    sheets: [...bySheet.values()],
    // The actionable payload the client ticks and sends back to /import.
    missingRows: buckets.missing,
    warnings,
  });
});
