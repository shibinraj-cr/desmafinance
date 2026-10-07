import type { TextItem } from "@/lib/bank/parsers/base";

/**
 * Builds the positioned text an HDFC statement PDF yields from pdf.js, so the
 * parser can be tested without committing a real (sensitive) statement.
 * Every name, number and reference here is invented; the column geometry
 * mirrors HDFC's layout — amounts right-aligned under their headers.
 */

export type FixtureRow = {
  date: string; // dd/mm/yy
  narration: string[]; // first line + continuation lines
  ref?: string;
  valueDate?: string;
  debit?: string;
  credit?: string;
  balance: string;
};

const COL = {
  date: 30,
  narration: 80,
  ref: 262,
  valueDate: 332,
  debitRight: 440,
  creditRight: 506,
  balanceRight: 582,
};
const CH = 4.6; // approx glyph width
const w = (s: string) => Math.round(s.length * CH * 100) / 100;

function item(str: string, x: number, y: number, page: number): TextItem {
  return { str, x, y, w: w(str), page };
}
function right(str: string, r: number, y: number, page: number): TextItem {
  return item(str, r - w(str), y, page);
}

function header(y: number, page: number): TextItem[] {
  return [
    item("Date", COL.date, y, page),
    item("Narration", COL.narration, y, page),
    item("Chq./Ref.No.", COL.ref, y, page),
    item("Value Dt", COL.valueDate, y, page),
    right("Withdrawal Amt.", COL.debitRight, y, page),
    right("Deposit Amt.", COL.creditRight, y, page),
    right("Closing Balance", COL.balanceRight, y, page),
  ];
}

export function hdfcFixture(opts: {
  account?: string;
  from?: string; // dd/mm/yyyy
  to?: string;
  rows: FixtureRow[];
  summary?: { opening: string; drCount: number; crCount: number; debits: string; credits: string; closing: string } | null;
  rowsPerPage?: number;
  /** Render the header as ONE text item. */
  mergedHeader?: boolean;
  /** …and give it no width, so no column positions can be derived — defeats the column strategy. */
  headerWithoutGeometry?: boolean;
}): TextItem[] {
  const items: TextItem[] = [];
  const perPage = opts.rowsPerPage ?? 40;
  let page = 1;
  let y = 40;
  const pageTop = () => {
    items.push(item("HDFC BANK LIMITED", 30, 20, page));
    items.push(item(`Account No : ${opts.account ?? "50100000001234"}`, 330, 60, page));
    items.push(item(`From : ${opts.from ?? "06/10/2026"} To : ${opts.to ?? "06/10/2026"}`, 330, 72, page));
    y = 110;
    if (opts.mergedHeader) {
      const h = item("Date Narration Chq./Ref.No. Value Dt Withdrawal Amt. Deposit Amt. Closing Balance", COL.date, y, page);
      items.push(opts.headerWithoutGeometry ? { ...h, w: 0 } : h);
    } else {
      items.push(...header(y, page));
    }
    y += 16;
  };
  pageTop();
  opts.rows.forEach((r, i) => {
    if (i > 0 && i % perPage === 0) {
      items.push(item(`Page No .: ${page}`, 280, 800, page));
      page++;
      pageTop();
    }
    items.push(item(r.date, COL.date, y, page));
    items.push(item(r.narration[0], COL.narration, y, page));
    if (r.ref) items.push(item(r.ref, COL.ref, y, page));
    items.push(item(r.valueDate ?? r.date, COL.valueDate, y, page));
    if (r.debit) items.push(right(r.debit, COL.debitRight, y, page));
    if (r.credit) items.push(right(r.credit, COL.creditRight, y, page));
    items.push(right(r.balance, COL.balanceRight, y, page));
    y += 12;
    for (const cont of r.narration.slice(1)) {
      items.push(item(cont, COL.narration, y, page));
      y += 12;
    }
  });
  y += 20;
  if (opts.summary !== null) {
    const s = opts.summary ?? autoSummary(opts.rows);
    items.push(item("STATEMENT SUMMARY :-", 30, y, page));
    y += 14;
    items.push(item("Opening Balance", 30, y, page));
    items.push(item("Dr Count", 140, y, page));
    items.push(item("Cr Count", 210, y, page));
    items.push(item("Debits", 290, y, page));
    items.push(item("Credits", 380, y, page));
    items.push(item("Closing Bal", 470, y, page));
    y += 12;
    items.push(item(s.opening, 30, y, page));
    items.push(item(String(s.drCount), 140, y, page));
    items.push(item(String(s.crCount), 210, y, page));
    items.push(item(s.debits, 290, y, page));
    items.push(item(s.credits, 380, y, page));
    items.push(item(s.closing, 470, y, page));
  }
  return items;
}

const toP = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);
const fmt = (p: number) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Summary consistent with the rows, opening derived from the first row. */
export function autoSummary(rows: FixtureRow[]) {
  const debits = rows.reduce((n, r) => n + (r.debit ? toP(r.debit) : 0), 0);
  const credits = rows.reduce((n, r) => n + (r.credit ? toP(r.credit) : 0), 0);
  const first = rows[0];
  const opening = first
    ? toP(first.balance) + (first.debit ? toP(first.debit) : 0) - (first.credit ? toP(first.credit) : 0)
    : 100_000_00;
  const closing = rows.length ? toP(rows[rows.length - 1].balance) : opening;
  return {
    opening: fmt(opening),
    drCount: rows.filter((r) => r.debit).length,
    crCount: rows.filter((r) => r.credit).length,
    debits: fmt(debits),
    credits: fmt(credits),
    closing: fmt(closing),
  };
}

/** N consistent rows starting from `openingPaise`, alternating debit/credit. */
export function generateRows(n: number, openingPaise = 5_00_000_00, date = "06/10/26"): FixtureRow[] {
  let bal = openingPaise;
  const rows: FixtureRow[] = [];
  for (let i = 0; i < n; i++) {
    const amt = (i % 7) * 1_234_56 + 10_000 + i;
    const isDebit = i % 3 !== 0;
    bal += isDebit ? -amt : amt;
    rows.push({
      date,
      narration: isDebit
        ? [`UPI-VENDOR ${i}-vendor${i}@okbank-ABCD0000123-${String(600000000000 + i)}-PAYMENT`]
        : [`NEFT CR-ABCD0001234-CUSTOMER ${i}-REF${i}`],
      ref: `${String(9000000000000 + i).padStart(16, "0")}`,
      debit: isDebit ? fmt(amt) : undefined,
      credit: isDebit ? undefined : fmt(amt),
      balance: fmt(bal),
    });
  }
  return rows;
}
