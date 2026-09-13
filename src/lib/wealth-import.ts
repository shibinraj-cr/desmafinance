import * as XLSX from "xlsx";

/**
 * Reading a personal investments workbook into the shapes the Personal Wealth
 * desk stores.
 *
 * Pure parsing, no database and no file paths — `prisma/import-wealth.ts` is the
 * runnable script that feeds this a workbook and writes the result. Split out so
 * the parsing is unit-tested against a synthetic workbook rather than against
 * anyone's real one: this repository is public, and none of these figures
 * belong in it.
 *
 * The sheet layout it expects is the ordinary one people actually keep:
 * a row per holding with loosely written headers, a gold list under category
 * headings, and borrowings in a summary block rather than a table. Every reader
 * below is deliberately forgiving, because a real workbook is.
 */

export type Cell = string | number | Date | null | undefined;

// ── parsing ─────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function text(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** A money cell: a number, "1 Cr", "12.5 L", or a range like "28000-29000"
 *  (taken at its midpoint, which is what a range in a premium column means). */
export function money(v: Cell): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().toLowerCase().replace(/,/g, "");
  if (!s) return null;

  const range = s.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;

  const scaled = s.match(/^(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lakh|lakhs|k)$/);
  if (scaled) {
    const n = Number(scaled[1]);
    const unit = scaled[2];
    if (unit.startsWith("cr")) return n * 1_00_00_000;
    if (unit === "k") return n * 1_000;
    return n * 1_00_000;
  }

  const plain = Number(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(plain) && s.match(/\d/) ? plain : null;
}

/** A date cell: a real date, or a written one like "as on 20th Dec 2024" /
 *  "mar 2026" (a bare month resolves to its last day). */
export function date(v: Cell): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);

  // A workbook read without `cellDates` hands dates over as Excel serials.
  // Accept them inside a range that can only be a date (roughly 1954–2119), so
  // a day-of-month like 22 or a weight like 483 is never mistaken for one.
  if (typeof v === "number") {
    if (v < 20_000 || v > 80_000) return null;
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const s = String(v).trim().toLowerCase().replace(/^as on\s+/, "").replace(/\s+/g, " ");
  if (!s) return null;

  const dmy = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\s+(\d{4})/);
  if (dmy) {
    const m = MONTHS[dmy[2].slice(0, 3)];
    if (m) return iso(Number(dmy[3]), m, Number(dmy[1]));
  }

  const my = s.match(/([a-z]{3,})\s+(\d{4})/);
  if (my) {
    const m = MONTHS[my[1].slice(0, 3)];
    if (m) return iso(Number(my[2]), m, lastDay(Number(my[2]), m));
  }

  const numeric = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (numeric) return `${numeric[1]}-${numeric[2]}-${numeric[3]}`;

  return null;
}

export function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, lastDay(y, m))).padStart(2, "0")}`;
}

export function frequency(v: Cell): string {
  const s = text(v).toLowerCase();
  if (!s) return "none";
  if (s.includes("month")) return "monthly";
  if (s.includes("quarter")) return "quarterly";
  if (/\b3\b|three/.test(s) && s.includes("year")) return "three_yearly";
  if (s.includes("year") || s.includes("annual")) return "yearly";
  if (s.includes("single") || s.includes("one time") || s.includes("one-time")) return "one_time";
  return "none";
}

/** "22nd" / "10th October" / "20th" → the day; a bare month name → null, since
 *  that is a yearly anchor rather than a day of the month. */
export function dayOfMonth(v: Cell): number | null {
  const s = text(v).toLowerCase();
  const m = s.match(/(\d{1,2})\s*(?:st|nd|rd|th)/);
  if (m) {
    const d = Number(m[1]);
    return d >= 1 && d <= 31 ? d : null;
  }
  const bare = s.match(/^(\d{1,2})$/);
  if (bare) {
    const d = Number(bare[1]);
    return d >= 1 && d <= 31 ? d : null;
  }
  return null;
}

export function termYears(v: Cell): number | null {
  const m = text(v).match(/(\d{1,3})\s*(?:year|yr)/i);
  return m ? Number(m[1]) : null;
}

/**
 * Class from generic product words only — no brand names, no institutions, and
 * nothing that identifies a person. That is a constraint, not an oversight:
 * this repository is public, so a keyword list tuned to one person's actual
 * portfolio would leak what is in it. A row with no product word (a private
 * loan, a receivable) lands in "other" and gets classified on the page, which
 * costs two clicks and gives nothing away.
 */
export function classify(name: string): string {
  const s = name.toLowerCase();
  if (/\bterm insurance\b|health|mediclaim|floater/.test(s)) return "protection";
  if (/ulip|lic\b|life\b|keyman|endowment|assurance|insurance/.test(s)) return "insurance";
  if (/\bmf\b|mutual|folio|demat|broker|trading|equity|stock|share|sip\b/.test(s))
    return "equity";
  if (/sukanya|ppf|nsc|post office|provident|recurring deposit|\brd\b|fixed deposit|\bfd\b/.test(s))
    return "savings";
  if (/bank|cash|balance|current a\/c|savings a\/c|\baccount\b/.test(s)) return "cash";
  return "other";
}

// ── sheets ──────────────────────────────────────────────────────────────────

export type Row = Record<string, Cell>;

export function readSheet(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet "${name}" not found. Sheets present: ${wb.SheetNames.join(", ")}`);
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true });
}

/** Find a column by a fragment of its header, so small header edits don't break
 *  the import ("Premium/investment" vs "Premium / Investment"). */
export function column(row: Row, ...fragments: string[]): Cell {
  for (const key of Object.keys(row)) {
    const k = key.toLowerCase().replace(/[^a-z]/g, "");
    for (const f of fragments) {
      if (k.includes(f.toLowerCase().replace(/[^a-z]/g, ""))) return row[key];
    }
  }
  return null;
}

export type HoldingIn = {
  name: string;
  assetClass: string;
  institution: string | null;
  policyNo: string | null;
  contributionAmount: number | null;
  frequency: string;
  dueDayOfMonth: number | null;
  renewalOn: string | null;
  termYears: number | null;
  sumAssured: number | null;
  portalUrl: string | null;
  value: number | null;
  valuedOn: string | null;
};

export function parseHoldings(rows: Row[]): HoldingIn[] {
  const out: HoldingIn[] = [];
  for (const row of rows) {
    const name = text(column(row, "plan", "holding", "name"));
    if (!name) continue;
    if (/^(total|net worth|cash invested|gold value|grand total)/i.test(name)) continue;

    const assetClass = classify(name);
    const renewalOn = date(column(row, "renewal"));
    const stated = frequency(column(row, "frequency"));
    const day = dayOfMonth(column(row, "date", "due"));
    // A row carrying a renewal date but no stated frequency still has a real
    // date worth remembering — keep it as a one-off rather than dropping it,
    // which is what an unqualified "none" would do.
    const freq = stated === "none" && renewalOn ? "one_time" : stated;

    out.push({
      name,
      assetClass,
      institution: text(column(row, "company", "institution")) || null,
      policyNo: text(column(row, "policyno", "policy")) || null,
      contributionAmount: money(column(row, "premium", "investment", "contribution")),
      frequency: freq,
      // A monthly schedule needs a day; anything else repeats from a date.
      dueDayOfMonth: freq === "monthly" ? day : null,
      renewalOn: freq === "monthly" ? null : renewalOn,
      termYears: termYears(column(row, "term")),
      sumAssured: assetClass === "protection" ? money(column(row, "sa", "sumassured", "cover")) : null,
      portalUrl: text(column(row, "link", "portal", "url")) || null,
      value: money(column(row, "networth", "value", "corpus")),
      valuedOn: date(column(row, "column1", "ason", "valuedon")),
    });
  }
  return out;
}

export type GoldIn = { category: string; name: string; grams: number; dueOn: string | null };

/**
 * The gold sheet is a list under category headings: a row with a label and no
 * weight starts a new category, a row with a weight is a piece in it.
 */
export function parseGold(
  wb: XLSX.WorkBook,
  sheetName: string,
): { items: GoldIn[]; ratePerGram: number | null } {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { items: [], ratePerGram: null };
  const grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: null, raw: true });

  const items: GoldIn[] = [];
  let category = "Uncategorised";
  let ratePerGram: number | null = null;

  for (const row of grid) {
    const label = text(row?.[0]);
    const grams = typeof row?.[1] === "number" ? row[1] : money(row?.[1]);

    // The per-gram rate sits loose in the summary block to the right of the
    // list — on whatever row it happened to be typed, often beside a piece.
    // Take the first right-hand value inside a plausible rate band: the totals
    // that share those columns (grams, pavan, the computed value) all fall
    // outside it. A wrong guess is corrected in one edit on the page, and no
    // guess at all leaves gold priced at zero, which is the louder failure.
    if (ratePerGram === null) {
      for (let c = 4; c <= 6; c++) {
        const v = money(row?.[c]);
        if (v !== null && v >= 1_000 && v <= 100_000) {
          ratePerGram = v;
          break;
        }
      }
    }

    if (!label) continue;
    if (/^(total|grams|pavan)$/i.test(label)) continue;

    if (grams === null || grams === 0) {
      category = label;
      continue;
    }
    items.push({ category, name: label, grams, dueOn: date(row?.[4]) });
  }

  return { items, ratePerGram };
}

export type LiabilityIn = { name: string; kind: string; outstanding: number };

/**
 * Borrowings live in the workbook's summary block rather than a table: a label
 * containing "loan" with a figure beside it. Figures there are quoted in lakhs,
 * which is how the block's own net-worth line adds up, so they are scaled.
 */
export function parseLiabilities(wb: XLSX.WorkBook, sheetName: string): LiabilityIn[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: null, raw: true });
  const out: LiabilityIn[] = [];

  for (const row of grid) {
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const label = text(row[c]);
      if (!/loan/i.test(label)) continue;
      const amount = money(row[c + 1]);
      if (amount === null) continue;
      const kind = /hous|home/i.test(label)
        ? "housing"
        : /car|vehicle|auto/i.test(label)
          ? "car"
          : /gold/i.test(label)
            ? "gold"
            : /personal/i.test(label)
              ? "personal"
              : "other";
      // Values under a thousand in this block are lakhs, not rupees.
      out.push({ name: label, kind, outstanding: amount < 100_000 ? amount * 1_00_000 : amount });
    }
  }
  return out;
}

