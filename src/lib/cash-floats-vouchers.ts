import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

/**
 * The director's Outdoor Marketing vouchers, read from Excel (server only).
 */

export type VoucherRow = { date: string; voucherNo: string | null; paidTo: string; purpose: string | null; amount: number };

type Col = "date" | "voucherNo" | "paidTo" | "purpose" | "amount";
const HEADERS: Array<[Col, RegExp]> = [
  ["date", /^(date|voucher date|paid on)$/],
  ["voucherNo", /^(voucher|voucher no\.?|voucher number|v\.? ?no\.?|no\.?)$/],
  ["paidTo", /^(paid to|payee|name|given to|to)$/],
  ["purpose", /^(purpose|details|description|particulars|remarks|for)$/],
  ["amount", /^(amount|amount \(₹\)|amount \(inr\)|rs\.?|₹)$/],
];
export const VOUCHER_HEADERS = ["Date", "Voucher No", "Paid To", "Purpose", "Amount"] as const;

const cellText = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());

function cellDate(v: unknown): string | null {
  if (typeof v === "number" && v > 20_000 && v < 80_000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? iso(d.y, d.m, d.d) : null;
  }
  const s = cellText(v);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s) ?? null;
  if (m) return iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[2]), Number(m[1]));
  const isoM = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return isoM ? iso(Number(isoM[1]), Number(isoM[2]), Number(isoM[3])) : null;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function cellPaise(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  const s = cellText(v).replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return n > 0 ? n : null;
}

/**
 * Read the director's voucher sheet: one row per voucher, columns found by
 * their header (Date, Voucher No, Paid To, Purpose, Amount). Blank rows and a
 * Total row are skipped; anything else unreadable is reported, never guessed.
 */
export function parseVoucherSheet(buf: Uint8Array, today: string): { rows: VoucherRow[]; problems: string[] } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "array", cellDates: false });
  } catch {
    return { rows: [], problems: ["The file could not be opened as a spreadsheet"] };
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], problems: ["The spreadsheet has no sheets"] };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
  const hdr = grid.findIndex((r, i) => i < 20 && headerMap(r) !== null);
  if (hdr < 0) return { rows: [], problems: [`No header row found: expected the columns ${VOUCHER_HEADERS.join(", ")}`] };
  const map = headerMap(grid[hdr])!;
  const rows: VoucherRow[] = [];
  const problems: string[] = [];
  for (let i = hdr + 1; i < grid.length; i++) {
    const r = grid[i];
    const at = (c: Col) => (map[c] === undefined ? "" : r[map[c]!]);
    if (r.every((c) => cellText(c) === "")) continue;
    if (/^total/i.test(cellText(at("date"))) || /^total/i.test(cellText(at("paidTo")))) continue;
    const date = cellDate(at("date"));
    const amount = cellPaise(at("amount"));
    const paidTo = cellText(at("paidTo"));
    const n = i + 1;
    if (!date) problems.push(`Row ${n}: the date "${cellText(at("date"))}" isn't a date (use dd/mm/yyyy)`);
    else if (date > today) problems.push(`Row ${n}: ${date} is in the future`);
    if (amount === null) problems.push(`Row ${n}: the amount "${cellText(at("amount"))}" isn't an amount`);
    if (!paidTo) problems.push(`Row ${n}: who was paid is missing`);
    if (!date || date > today || amount === null || !paidTo) continue;
    rows.push({ date, voucherNo: cellText(at("voucherNo")) || null, paidTo: paidTo.slice(0, 120), purpose: cellText(at("purpose")).slice(0, 300) || null, amount });
  }
  return { rows, problems };
}

function headerMap(row: unknown[]): Partial<Record<Col, number>> | null {
  const map: Partial<Record<Col, number>> = {};
  row.forEach((c, i) => {
    const k = cellText(c).toLowerCase();
    for (const [col, re] of HEADERS) if (map[col] === undefined && re.test(k)) map[col] = i;
  });
  return map.date !== undefined && map.paidTo !== undefined && map.amount !== undefined ? map : null;
}

/**
 * Each voucher's identity, so the same voucher uploaded again (the same sheet,
 * or a later one that repeats it) adds nothing. Two identical rows in one
 * sheet (same day, payee, amount, no voucher number) are two vouchers: the
 * n-th of them is told apart by n, and a re-upload repeats the same n.
 */
export function voucherHashes(rows: VoucherRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const key = [r.date, (r.voucherNo ?? "").toUpperCase(), r.paidTo.toUpperCase().replace(/\s+/g, " "), r.amount].join("|");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return createHash("sha256").update(`${key}|${n}`).digest("hex");
  });
}
