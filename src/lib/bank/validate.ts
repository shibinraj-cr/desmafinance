import type { ParsedStatement } from "./parsers/base";
import { addDays } from "../lead-pulse-dates";

/**
 * The checks a parsed statement must pass before its rows may be imported
 * without a person looking at them. Any error → REVIEW_REQUIRED (rows held on
 * the statement, nothing written to BankTransaction). Warnings are recorded
 * but do not stop the import.
 *
 * Money is compared in integer paise with ZERO tolerance: a statement prints
 * exact amounts, so any difference at all means a misread row, not rounding.
 */

export type ValidationResult = { errors: string[]; warnings: string[] };

export function validateStatement(
  p: ParsedStatement,
  expect: { last4: string; periodStart: string | null; periodEnd: string | null; today: string },
): ValidationResult {
  const errors: string[] = [...p.anomalies];
  const warnings: string[] = [...p.warnings];

  // 1. Belongs to the expected account.
  if (p.accountNumber) {
    const digits = p.accountNumber.replace(/[^0-9]/g, "");
    if (!digits.endsWith(expect.last4)) {
      errors.push(`Statement account ends ${digits.slice(-4) || "????"}, expected ${expect.last4}`);
    }
  } else {
    warnings.push("Account number not found on the statement");
  }

  // 2. Period matches the e-mail's.
  if (expect.periodStart && expect.periodEnd && p.periodStart && p.periodEnd) {
    if (p.periodStart !== expect.periodStart || p.periodEnd !== expect.periodEnd) {
      errors.push(
        `Statement period ${p.periodStart} → ${p.periodEnd} differs from the e-mail's ${expect.periodStart} → ${expect.periodEnd}`,
      );
    }
  } else if (!p.periodStart) {
    warnings.push("Statement period not found on the statement");
  }

  // 3. Dates are plausible.
  const lo = p.periodStart ?? expect.periodStart ?? addDays(expect.today, -400);
  const hi = p.periodEnd ?? expect.periodEnd ?? addDays(expect.today, 1);
  for (const r of p.rows) {
    if (r.txnDate < lo || r.txnDate > hi) {
      errors.push(`Row ${r.rowIndex + 1} date ${r.txnDate} is outside the statement period ${lo} → ${hi}`);
    }
    if (r.txnDate > addDays(expect.today, 1)) errors.push(`Row ${r.rowIndex + 1} is dated in the future (${r.txnDate})`);
    if (r.valueDate && Math.abs(daysBetween(r.txnDate, r.valueDate)) > 31) {
      warnings.push(`Row ${r.rowIndex + 1} value date ${r.valueDate} is far from its transaction date`);
    }
  }

  // 4. Amounts are numeric, positive, one side only.
  for (const r of p.rows) {
    if (r.debit < 0 || r.credit < 0) errors.push(`Row ${r.rowIndex + 1} has a negative amount`);
    if ((r.debit > 0) === (r.credit > 0)) errors.push(`Row ${r.rowIndex + 1} must have exactly one of debit or credit`);
    if (!r.description) warnings.push(`Row ${r.rowIndex + 1} has an empty narration`);
  }

  // 5. Running balance chains row to row.
  let prev = p.openingBalance;
  let chainBreaks = 0;
  for (const r of p.rows) {
    if (r.balance === null) {
      warnings.push(`Row ${r.rowIndex + 1} has no running balance`);
      continue;
    }
    if (prev !== null && prev + r.credit - r.debit !== r.balance) chainBreaks++;
    prev = r.balance;
  }
  if (chainBreaks) errors.push(`Running balance does not chain on ${chainBreaks} row${chainBreaks === 1 ? "" : "s"}`);

  // 6. Opening + credits − debits = closing, and the summary agrees with the rows.
  const debits = p.rows.reduce((s, r) => s + r.debit, 0);
  const credits = p.rows.reduce((s, r) => s + r.credit, 0);
  if (p.openingBalance !== null && p.closingBalance !== null) {
    if (p.openingBalance + credits - debits !== p.closingBalance) {
      errors.push("Opening balance + credits − debits does not equal the closing balance");
    }
  } else {
    warnings.push("No opening/closing balance on the statement — balance check skipped");
  }
  if (p.summary) {
    if (p.summary.totalDebit !== debits) errors.push("Total debits differ from the statement summary");
    if (p.summary.totalCredit !== credits) errors.push("Total credits differ from the statement summary");
    const dr = p.rows.filter((r) => r.debit > 0).length;
    const cr = p.rows.filter((r) => r.credit > 0).length;
    if (p.summary.debitCount !== null && p.summary.debitCount !== dr) {
      errors.push(`Summary shows ${p.summary.debitCount} debits, ${dr} were read`);
    }
    if (p.summary.creditCount !== null && p.summary.creditCount !== cr) {
      errors.push(`Summary shows ${p.summary.creditCount} credits, ${cr} were read`);
    }
  }

  return { errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)) };
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
}
