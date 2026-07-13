import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { phoneMatchKeys } from "@/lib/crm";
import {
  parseVoxbayCsv,
  aggregateCallers,
  collectCallerPhoneKeys,
  reconcileCallers,
  parseSinceDate,
} from "@/lib/crm-voxbay-reconcile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VOXBAY_RECONCILE_PAGE = "/crm/voxbay-reconcile";
const LARGE_MISSING_WARN = 3000;

// POST /api/crm/voxbay-reconcile — parse a Voxbay incoming-call CSV and report
// which callers (since the chosen date) have no matching CRM lead. Read-only.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canSeePage(perms, VOXBAY_RECONCILE_PAGE)) throw forbidden();

  const formData = await req.formData().catch(() => null);
  if (!formData) throw badRequest("Could not read the upload", "bad_form");
  const file = formData.get("file");
  if (!file || typeof file === "string") throw badRequest("No file provided", "no_file");
  const sinceRaw = String(formData.get("sinceDate") ?? "").trim();
  const sinceStart = parseSinceDate(sinceRaw);
  if (!sinceStart) throw badRequest("Pick a valid reconciliation date (YYYY-MM-DD).", "bad_date");

  const text = await (file as File).text();
  const { rows, header } = parseVoxbayCsv(text);
  if (rows.length === 0) {
    throw badRequest("No call rows found. Upload the Voxbay incoming-call CSV (with a sourceNumber column).", "no_rows");
  }
  if (!header.includes("sourceNumber")) {
    throw badRequest("This doesn't look like a Voxbay call report — no sourceNumber column.", "bad_csv");
  }

  const { callers, beforeSince, noNumber, undated } = aggregateCallers(rows, sinceStart);

  // One batched lookup: do any CRM leads carry these caller numbers?
  const phoneKeys = collectCallerPhoneKeys(callers);
  const existingPhone = new Set<string>();
  const CHUNK = 2000;
  for (let i = 0; i < phoneKeys.length; i += CHUNK) {
    const part = phoneKeys.slice(i, i + CHUNK);
    const found = await prisma.lead.findMany({
      where: { OR: [{ phoneE164: { in: part } }, { altPhoneE164: { in: part } }] },
      select: { phoneE164: true, altPhoneE164: true },
    });
    for (const f of found) for (const k of phoneMatchKeys(f.phoneE164, f.altPhoneE164)) existingPhone.add(k);
  }

  const { missing, inCrm } = reconcileCallers(callers, existingPhone);

  const warnings: string[] = [];
  if (noNumber) warnings.push(`${noNumber} call row(s) had no usable caller number and were skipped.`);
  if (undated) warnings.push(`${undated} call row(s) had no readable timestamp and were skipped.`);
  if (missing.length > LARGE_MISSING_WARN) {
    warnings.push(`${missing.length.toLocaleString("en-IN")} callers missing — the table may be slow. Consider a later date.`);
  }

  return NextResponse.json({
    sinceDate: sinceRaw,
    fileName: typeof (file as File).name === "string" ? (file as File).name : null,
    totals: {
      callRows: rows.length,
      uniqueCallers: callers.length,
      missing: missing.length,
      inCrm: inCrm.length,
      beforeSince,
      noNumber,
      undated,
    },
    // Actionable payload the client ticks and sends to /import. Sorted so the
    // most-persistent callers (most calls) surface first.
    missingCallers: missing.sort((a, b) => b.callCount - a.callCount),
    warnings,
  });
});
