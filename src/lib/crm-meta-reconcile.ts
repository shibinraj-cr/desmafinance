// Meta Leads reconciliation — parse a Meta Lead-Ads export (a multi-sheet .xlsx
// where each sheet is a campaign) and reconcile it against existing CRM leads to
// surface candidates that are MISSING from the CRM. Nothing here writes to the
// DB: the pure parse/normalize/classify logic lives here so it's unit-testable;
// the route layer batches the CRM lookups and the create/re-inquiry writes.
//
// Why raw:true matters: Excel stores phone numbers as NUMBERS and DISPLAYS them
// in scientific notation ("9.19746E+11"). Reading with raw:false yields that
// useless string — the digits are gone. raw:true returns the underlying integer
// (919746399999) intact, so phone matching actually works. See the tests.
import * as XLSX from "xlsx";
import { normalizePhone, emailKeyOf, phoneMatchKeys } from "./crm";

// ── Canonical fields we map spreadsheet headers onto ────────────────────────
// Meta form exports vary wildly in header spelling from sheet to sheet
// (Name/Full Name/name; Phone/Phone Number; a separate WhatsApp column; Email vs
// " Email" with a leading space; Date/date/"Column 1"). Everything else is kept
// verbatim in `extra` so no captured answer is silently dropped.
const HEADER_ALIASES: Record<string, string> = {
  name: "candidateName",
  "full name": "candidateName",
  "candidate name": "candidateName",
  candidate: "candidateName",

  phone: "phone",
  "phone number": "phone",
  "phone no": "phone",
  mobile: "phone",
  contact: "phone",
  "contact number": "phone",

  // WhatsApp columns are treated as the ALTERNATE number — it still joins the
  // match key set, so a WhatsApp-only collision is caught.
  "whatsapp number": "altPhone",
  "enter your whatsapp number": "altPhone",
  whatsapp: "altPhone",
  "whatsapp no": "altPhone",
  "alternate number": "altPhone",
  "alternative number": "altPhone",
  "alt number": "altPhone",

  email: "email",
  " email": "email",
  "email address": "email",
  "e-mail": "email",

  date: "date",
  "created time": "date",
  created_time: "date",
  "creation date": "date",
  "created at": "date",

  "campaign name": "campaign",
  campaign: "campaign",

  city: "city",
  place: "city",
};

const CORE_FIELDS = new Set(["candidateName", "phone", "altPhone", "email", "date", "campaign", "city"]);

/** Normalise a header cell: string, collapse inner whitespace/newlines, lowercase. */
export function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Coerce a phone cell to a bare string of what the user typed. Excel gives us a
 * NUMBER for numeric phone cells (with `raw:true`) — stringify the integer, never
 * the float, so we never reintroduce scientific notation or a trailing ".0".
 * Text cells (e.g. "+91 78142 95082") pass through untouched for normalizePhone
 * to strip.
 */
export function coercePhoneCell(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) return "";
    return String(Math.trunc(cell));
  }
  return String(cell).trim();
}

/**
 * Parse a Meta date cell into a Date, or null when absent/unparseable. Meta
 * exports store ISO 8601 strings, sometimes with a `+0000`/`+05:30` offset (both
 * parse natively); real Excel date cells arrive as Date objects (via cellDates).
 * A `dd/mm/yyyy` or `dd-mm-yyyy` fallback covers the occasional localided sheet.
 */
export function parseMetaDate(cell: unknown): Date | null {
  if (cell == null || cell === "") return null;
  if (cell instanceof Date) return isNaN(cell.getTime()) ? null : cell;
  // A bare number here is NOT a date (cellDates already converted real date
  // cells to Date objects; a leftover number is something else).
  if (typeof cell === "number") return null;

  const s = String(cell).trim();
  if (!s) return null;

  const iso = new Date(s);
  if (!isNaN(iso.getTime()) && /\d{4}-\d{2}-\d{2}/.test(s)) return iso;

  // dd/mm/yyyy or dd-mm-yyyy, optional ", h:mm am/pm" tail.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d.getTime())) return d;
  }
  // Last resort: whatever Date can make of it.
  return isNaN(iso.getTime()) ? null : iso;
}

// ── Types ───────────────────────────────────────────────────────────────────

/** One normalised Meta row. `extra` keeps every unmapped, non-blank column. */
export type MetaLeadRow = {
  sheetName: string;
  /** 1-based row number within the sheet (header is row 1), for user reference. */
  rowNumber: number;
  campaign: string | null;
  candidateName: string;
  email: string | null;
  phone: string | null;
  altPhone: string | null;
  phoneE164: string | null;
  altPhoneE164: string | null;
  emailKey: string | null;
  city: string | null;
  /** ISO string (serialisable) of the Meta creation date, or null. */
  createdAt: string | null;
  extra: Record<string, string> | null;
};

export type MetaSheetSummary = {
  sheetName: string;
  headers: string[];
  /** canonical field → header text that mapped to it (for the UI to show). */
  mapping: Record<string, string>;
  dataRowCount: number;
  /** Skipped entirely — no recognisable lead columns (e.g. a summary tab). */
  skipped: boolean;
  skipReason?: string;
  /** Heuristic: looks like a non-lead campaign (e.g. Hiring) — untick by default. */
  isLikelyNonLead: boolean;
  warnings: string[];
};

export type ParsedMetaSheet = MetaSheetSummary & { rows: MetaLeadRow[] };
export type ParsedMetaWorkbook = { sheets: ParsedMetaSheet[] };

// ── Parse ────────────────────────────────────────────────────────────────────

function looksLikeNonLeadCampaign(sheetName: string, rows: MetaLeadRow[]): boolean {
  const name = sheetName.toLowerCase();
  if (/\bhiring\b|telesales|recruit|internal/.test(name)) return true;
  const sampleCampaign = rows.find((r) => r.campaign)?.campaign?.toLowerCase() ?? "";
  return /\bhiring\b|telesales|recruit/.test(sampleCampaign);
}

/** Read a workbook buffer into normalised per-sheet rows. Never touches the DB. */
export function parseMetaWorkbook(buf: Buffer): ParsedMetaWorkbook {
  const wb = XLSX.read(buf, { cellDates: true });
  const sheets: ParsedMetaSheet[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const warnings: string[] = [];
    if (!ws) {
      sheets.push({ sheetName, headers: [], mapping: {}, dataRowCount: 0, skipped: true, skipReason: "empty sheet", isLikelyNonLead: false, warnings, rows: [] });
      continue;
    }
    // raw:true is essential — see the file header comment about phone precision.
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
    const dataStart = 1;
    const dataRowCount = grid.slice(dataStart).filter((r) => r.some((c) => String(c ?? "").trim() !== "")).length;

    const headerCells = (grid[0] ?? []) as unknown[];
    const headers = headerCells.map((h) => String(h ?? "").trim());

    // Map header index → canonical field. First header wins for a given field.
    const colOf: Record<string, number> = {};
    const mapping: Record<string, string> = {};
    const extraCols: { header: string; col: number }[] = [];
    headerCells.forEach((h, i) => {
      const canonical = HEADER_ALIASES[normalizeHeader(h)];
      if (canonical) {
        if (colOf[canonical] === undefined) {
          colOf[canonical] = i;
          mapping[canonical] = headers[i];
        }
      } else if (String(h ?? "").trim()) {
        extraCols.push({ header: headers[i], col: i });
      }
    });

    // Positional date fallback: some sheets label the date column "Column 1" (or
    // leave it blank). If no date header mapped but column 0's values parse as
    // dates, adopt column 0 as the date.
    if (colOf.date === undefined && headerCells.length) {
      const sample = grid.slice(dataStart, dataStart + 8).map((r) => (r as unknown[])[0]);
      const hits = sample.filter((c) => parseMetaDate(c)).length;
      if (hits >= Math.max(1, Math.ceil(sample.filter((c) => String(c ?? "").trim()).length / 2))) {
        colOf.date = 0;
        mapping.date = headers[0] || "(column 1)";
        // If column 0 was captured as an extra, drop it (it's the date now).
        const ei = extraCols.findIndex((e) => e.col === 0);
        if (ei >= 0) extraCols.splice(ei, 1);
      }
    }

    // A sheet with no name AND no phone AND no email is not a lead sheet (e.g. a
    // "Daily Report" summary tab) — skip it, but report why.
    const hasLeadCols = colOf.candidateName !== undefined || colOf.phone !== undefined || colOf.email !== undefined;
    if (!hasLeadCols) {
      sheets.push({
        sheetName, headers, mapping, dataRowCount,
        skipped: true, skipReason: "no Name / Phone / Email column found",
        isLikelyNonLead: false, warnings, rows: [],
      });
      continue;
    }

    const cellAt = (row: unknown[], field: string): unknown => (colOf[field] === undefined ? "" : row[colOf[field]]);
    const strAt = (row: unknown[], field: string): string => String(cellAt(row, field) ?? "").trim();

    const rows: MetaLeadRow[] = [];
    for (let r = dataStart; r < grid.length; r++) {
      const row = grid[r] as unknown[];
      if (!row.some((c) => String(c ?? "").trim() !== "")) continue; // blank row

      const candidateName = strAt(row, "candidateName");
      const phoneRaw = coercePhoneCell(cellAt(row, "phone"));
      const altPhoneRaw = coercePhoneCell(cellAt(row, "altPhone"));
      const email = strAt(row, "email") || null;
      const phone = phoneRaw || null;
      const altPhone = altPhoneRaw || null;
      const phoneE164 = normalizePhone(phone);
      const altPhoneE164 = normalizePhone(altPhone);
      const emailKey = emailKeyOf(email);
      const campaign = strAt(row, "campaign") || sheetName;
      const city = strAt(row, "city") || null;
      const createdAt = parseMetaDate(cellAt(row, "date"));

      const extra: Record<string, string> = {};
      for (const { header, col } of extraCols) {
        const v = String(row[col] ?? "").trim();
        if (v) extra[header] = v;
      }

      rows.push({
        sheetName,
        rowNumber: r + 1,
        campaign,
        candidateName,
        email,
        phone,
        altPhone,
        phoneE164,
        altPhoneE164,
        emailKey,
        city,
        createdAt: createdAt ? createdAt.toISOString() : null,
        extra: Object.keys(extra).length ? extra : null,
      });
    }

    if (colOf.date === undefined) warnings.push("No date column detected — every row lands in the “no date” bucket.");

    sheets.push({
      sheetName, headers, mapping, dataRowCount,
      skipped: false, isLikelyNonLead: looksLikeNonLeadCampaign(sheetName, rows),
      warnings, rows,
    });
  }

  return { sheets };
}

// ── Reconcile ─────────────────────────────────────────────────────────────────

/** The match keys a row contributes (phone identity set + email key). */
export function metaRowKeys(row: MetaLeadRow): { emailKey: string | null; phoneKeys: string[] } {
  return { emailKey: row.emailKey, phoneKeys: phoneMatchKeys(row.phoneE164, row.altPhoneE164) };
}

/** A row can be reconciled only if it carries at least one match key. */
export function isReconcilable(row: MetaLeadRow): boolean {
  return !!row.emailKey || !!row.phoneE164 || !!row.altPhoneE164;
}

/**
 * Collect the distinct email/phone keys of in-window, reconcilable rows — the
 * exact set the route needs to look up against existing CRM leads (one batched
 * query instead of a lookup per row).
 */
export function collectLookupKeys(rows: MetaLeadRow[], sinceStart: Date): { emailKeys: string[]; phoneKeys: string[] } {
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const row of rows) {
    if (!isReconcilable(row)) continue;
    if (!row.createdAt) continue; // no date → not in the window
    if (new Date(row.createdAt).getTime() < sinceStart.getTime()) continue;
    const { emailKey, phoneKeys } = metaRowKeys(row);
    if (emailKey) emails.add(emailKey);
    for (const p of phoneKeys) phones.add(p);
  }
  return { emailKeys: [...emails], phoneKeys: [...phones] };
}

export type ReconcileBuckets = {
  /** In-window, reconcilable, NOT in CRM, first sighting in the file → import candidates. */
  missing: MetaLeadRow[];
  /** In-window, found in CRM (a re-submission would fold to a re-inquiry). */
  matchedInCrm: MetaLeadRow[];
  /** In-window, reconcilable, but a duplicate of an earlier row in the same file. */
  withinFileDupes: MetaLeadRow[];
  /** Filtered out because the creation date is before the chosen date. */
  beforeSince: MetaLeadRow[];
  /** Reconcilable but no parseable date — the date filter can't apply. */
  noDate: MetaLeadRow[];
  /** No phone AND no email — impossible to match or dedupe. */
  unmatchable: MetaLeadRow[];
};

function emptyBuckets(): ReconcileBuckets {
  return { missing: [], matchedInCrm: [], withinFileDupes: [], beforeSince: [], noDate: [], unmatchable: [] };
}

/**
 * Classify every row into a bucket given the chosen since-date and the set of
 * match keys already present in the CRM. Pure — the caller supplies the existing
 * key sets (built from a batched query), so this is trivially unit-testable.
 *
 * Order of checks: unmatchable → no date → before the date → matched in CRM →
 * within-file duplicate → missing. Within-file dedup keeps the FIRST sighting as
 * the import candidate and buckets later ones as duplicates (so the same person
 * is imported once).
 */
export function reconcileRows(
  rows: MetaLeadRow[],
  sinceStart: Date,
  existing: { emailKeys: Set<string>; phoneKeys: Set<string> },
): ReconcileBuckets {
  const out = emptyBuckets();
  const seenEmail = new Set<string>();
  const seenPhone = new Set<string>();

  for (const row of rows) {
    if (!isReconcilable(row)) {
      out.unmatchable.push(row);
      continue;
    }
    if (!row.createdAt) {
      out.noDate.push(row);
      continue;
    }
    if (new Date(row.createdAt).getTime() < sinceStart.getTime()) {
      out.beforeSince.push(row);
      continue;
    }
    const { emailKey, phoneKeys } = metaRowKeys(row);
    const inCrm =
      (emailKey && existing.emailKeys.has(emailKey)) || phoneKeys.some((p) => existing.phoneKeys.has(p));
    if (inCrm) {
      out.matchedInCrm.push(row);
      continue;
    }
    const inFile = (emailKey && seenEmail.has(emailKey)) || phoneKeys.some((p) => seenPhone.has(p));
    if (inFile) {
      out.withinFileDupes.push(row);
      continue;
    }
    if (emailKey) seenEmail.add(emailKey);
    for (const p of phoneKeys) seenPhone.add(p);
    out.missing.push(row);
  }

  return out;
}

/** Parse the user's "since" date (YYYY-MM-DD) as IST midnight — the business TZ. */
export function parseSinceDate(input: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const d = new Date(`${input}T00:00:00+05:30`);
  return isNaN(d.getTime()) ? null : d;
}
