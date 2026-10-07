import { BankAutomationError } from "../errors";
import { parseAmount, type Paise } from "../money";
import { isoIfValid } from "../email-parse";

/**
 * The bank-agnostic half of statement parsing. src/lib/bank/pdf.ts turns a PDF
 * into positioned text items; a bank parser turns those into rows. Adding a
 * bank is a subclass of BaseBankStatementParser registered in ./index.ts —
 * nothing else in the pipeline changes.
 */

/** One run of text on a page. `y` is measured from the TOP of the page. */
export type TextItem = { str: string; x: number; y: number; w: number; page: number };

/** Items sharing a baseline, left to right. */
export type Line = { page: number; y: number; items: TextItem[]; text: string };

export type ParsedRow = {
  rowIndex: number;
  txnDate: string;
  valueDate: string | null;
  description: string;
  referenceNumber: string | null;
  chequeNumber: string | null;
  debit: Paise;
  credit: Paise;
  balance: Paise | null;
  rawText: string;
};

export type StatementSummary = {
  openingBalance: Paise;
  closingBalance: Paise;
  debitCount: number | null;
  creditCount: number | null;
  totalDebit: Paise;
  totalCredit: Paise;
};

export type ParsedStatement = {
  bankCode: string;
  strategy: string;
  /** Account number as printed (may be partly masked), if found. */
  accountNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: Paise | null;
  closingBalance: Paise | null;
  summary: StatementSummary | null;
  rows: ParsedRow[];
  /** Things that make the extraction untrustworthy — any one sends it to review. */
  anomalies: string[];
  /** Worth knowing, not worth stopping for. */
  warnings: string[];
};

/** Group positioned items into lines (same page, baseline within `tol`). */
export function groupLines(items: TextItem[], tol = 2.5): Line[] {
  const sorted = items
    .filter((i) => i.str.trim() !== "")
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= tol) {
      last.items.push(it);
    } else {
      lines.push({ page: it.page, y: it.y, items: [it], text: "" });
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str.trim()).join(" ").replace(/\s+/g, " ").trim();
  }
  return lines;
}

/**
 * Split items into whitespace-separated tokens with estimated positions.
 *
 * pdf.js fuses neighbouring cells into one item when the gap is small
 * ("06/10/26 UPI-ACME-", "25,000.00 1,23,750.00"), so column placement has
 * to work per token. Each token's x is interpolated by character offset —
 * close enough to tell columns apart, since statement digits are tabular.
 */
export function tokenize(items: TextItem[]): TextItem[] {
  const out: TextItem[] = [];
  for (const it of items) {
    const s = it.str;
    if (!/\s/.test(s.trim())) {
      out.push({ ...it, str: s.trim() });
      continue;
    }
    const per = s.length ? it.w / s.length : 0;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      out.push({ str: m[0], x: it.x + m.index * per, y: it.y, w: m[0].length * per, page: it.page });
    }
  }
  return out;
}

/** "06/10/26" | "06/10/2026" → "2026-10-06". Two-digit years are 20yy. */
export function parseSlashDate(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return isoIfValid(y, Number(m[2]), Number(m[1]));
}

export const SLASH_DATE = /^\d{2}\/\d{2}\/(\d{2}|\d{4})$/;

export function amountOf(s: string): Paise | null {
  return parseAmount(s);
}

/**
 * Settle each row's debit/credit against the running balance. The balance
 * column is the most reliable thing a statement prints, so where a row's
 * column placement disagrees with the balance movement, the movement wins and
 * the disagreement is recorded as an anomaly — the statement then goes to a
 * person rather than being imported on a guess. This is the guard against
 * reversed debit/credit columns.
 */
export function reconcileDirections(rows: ParsedRow[], opening: Paise | null, anomalies: string[]): void {
  let prev = opening;
  for (const r of rows) {
    const amount = r.debit || r.credit;
    if (r.debit && r.credit) {
      anomalies.push(`Row ${r.rowIndex + 1} (${r.txnDate}) has both a debit and a credit amount`);
    } else if (!amount) {
      anomalies.push(`Row ${r.rowIndex + 1} (${r.txnDate}) has no amount`);
    } else if (prev !== null && r.balance !== null) {
      const delta = r.balance - prev;
      const columnSaysDebit = r.debit > 0;
      if (delta === -amount && !columnSaysDebit) {
        anomalies.push(`Row ${r.rowIndex + 1} (${r.txnDate}) read as a credit but the balance fell — direction corrected`);
        r.debit = amount;
        r.credit = 0;
      } else if (delta === amount && columnSaysDebit) {
        anomalies.push(`Row ${r.rowIndex + 1} (${r.txnDate}) read as a debit but the balance rose — direction corrected`);
        r.credit = amount;
        r.debit = 0;
      }
    }
    if (r.balance !== null) prev = r.balance;
  }
}

export abstract class BaseBankStatementParser {
  abstract readonly bankCode: string;

  /** Strategies in order of preference; the first that yields a usable result wins. */
  protected abstract strategies(): Array<{ name: string; run: (lines: Line[]) => ParsedStatement }>;

  /**
   * Primary strategy first. If it throws, reads no rows from a statement that
   * clearly has some, or reads rows with anomalies, the fallback runs on the
   * same text ("retry once with the fallback parser") and a clean result
   * wins. When no strategy is clean, the one with the fewest anomalies is
   * returned — validation then holds it for review rather than importing it.
   * Throws PARSE_FAILED only when every strategy fails outright.
   */
  parse(items: TextItem[]): ParsedStatement {
    if (items.length === 0) {
      throw new BankAutomationError(
        "PARSE_FAILED",
        "The PDF has no extractable text (image-only statement). OCR is not enabled.",
      );
    }
    const lines = groupLines(items);
    const errors: string[] = [];
    let best: ParsedStatement | null = null;
    for (const s of this.strategies()) {
      let res: ParsedStatement;
      try {
        res = s.run(lines);
      } catch (e) {
        errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const expectsRows =
        res.summary !== null &&
        ((res.summary.debitCount ?? 0) + (res.summary.creditCount ?? 0) > 0 ||
          res.summary.totalDebit + res.summary.totalCredit > 0);
      if (res.rows.length === 0 && expectsRows) {
        errors.push(`${s.name}: summary shows transactions but no rows were read`);
        continue;
      }
      if (res.anomalies.length === 0 && (res.rows.length > 0 || !expectsRows)) {
        // Clean — but an empty read only wins if nothing better turns up.
        if (res.rows.length > 0) return res;
        best ??= res;
        continue;
      }
      if (!best || (best.anomalies.length > 0 && res.anomalies.length < best.anomalies.length)) best = res;
    }
    if (best) return best;
    throw new BankAutomationError("PARSE_FAILED", `Statement layout not recognised (${errors.join("; ")})`);
  }
}
