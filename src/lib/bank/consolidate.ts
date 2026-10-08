import { addIsoDays } from "./schedule";

/**
 * The consolidated statement: every imported transaction for an account, in
 * date order, as one continuous ledger — whichever PDFs they came from.
 * Duplicates never reach it (the import refuses them), so this only has to
 * answer "is it complete?":
 *
 *   - balance breaks — a row whose running balance does not follow from the
 *     previous row's. Inside one statement that cannot happen (validation
 *     holds such a statement for review), so a break means transactions are
 *     missing BETWEEN statements;
 *   - coverage gaps — calendar days inside the range no imported statement
 *     covers.
 *
 * Money is integer paise throughout.
 */

export type ConsolidatedRow = {
  id: string;
  txnDate: string;
  debit: number; // paise
  credit: number; // paise
  balance: number | null; // paise
  description: string;
};

export type Coverage = { start: string; end: string };

export type ConsolidatedSummary = {
  count: number;
  firstDate: string | null;
  lastDate: string | null;
  opening: number | null;
  closing: number | null;
  totalDebit: number;
  totalCredit: number;
  /** opening + credits − debits = closing */
  reconciles: boolean | null;
  breaks: Array<{ id: string; date: string; expected: number; actual: number; description: string }>;
  gaps: Coverage[];
};

export function consolidate(rows: ConsolidatedRow[], covered: Coverage[], range: { from: string | null; to: string | null }): ConsolidatedSummary {
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const opening = first && first.balance !== null ? first.balance - first.credit + first.debit : null;
  const closing = last ? last.balance : null;

  const breaks: ConsolidatedSummary["breaks"] = [];
  let prev: number | null = opening;
  for (const r of rows) {
    if (r.balance === null) continue;
    if (prev !== null) {
      const expected = prev + r.credit - r.debit;
      if (expected !== r.balance) breaks.push({ id: r.id, date: r.txnDate, expected, actual: r.balance, description: r.description });
    }
    prev = r.balance;
  }

  return {
    count: rows.length,
    firstDate: first?.txnDate ?? null,
    lastDate: last?.txnDate ?? null,
    opening,
    closing,
    totalDebit,
    totalCredit,
    reconciles: opening !== null && closing !== null ? opening + totalCredit - totalDebit === closing : null,
    breaks,
    gaps: coverageGaps(covered, range),
  };
}

/** Days in [from, to] (default: the span of the statements) that no statement period covers, as ranges. */
export function coverageGaps(covered: Coverage[], range: { from: string | null; to: string | null }): Coverage[] {
  const spans = covered.filter((c) => c.start <= c.end).sort((a, b) => a.start.localeCompare(b.start));
  if (spans.length === 0) return [];
  const lo = range.from ?? spans[0].start;
  const hi = range.to ?? spans.reduce((m, c) => (c.end > m ? c.end : m), spans[0].end);
  const gaps: Coverage[] = [];
  let cursor = lo; // first day not yet known to be covered
  for (const c of spans) {
    if (c.end < cursor) continue;
    if (c.start > cursor) {
      const gapEnd = addIsoDays(c.start, -1) < hi ? addIsoDays(c.start, -1) : hi;
      if (cursor <= gapEnd) gaps.push({ start: cursor, end: gapEnd });
    }
    if (addIsoDays(c.end, 1) > cursor) cursor = addIsoDays(c.end, 1);
    if (cursor > hi) break;
  }
  if (cursor <= hi) gaps.push({ start: cursor, end: hi });
  return gaps;
}
