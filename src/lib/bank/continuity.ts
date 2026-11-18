import { prisma } from "@/lib/prisma";
import { addDays, fromPrismaDate, toPrismaDate } from "@/lib/lead-pulse-dates";
import { fromDecimal, toDecimalString, type Paise } from "./money";
import type { ParsedStatement } from "./parsers/base";
import type { ValidationResult } from "./validate";

/**
 * A statement must pick up where the last one left off: its opening balance is
 * the closing balance of the statement for the days just before it, and its
 * closing balance the opening of the one just after (when older months are
 * uploaded late). A break between two back-to-back statements means a misread
 * or a missing line, so it is an error and the statement is held for review. A
 * stretch of days no statement covers is only a warning: the missing statement
 * can be uploaded later.
 */

export type Neighbour = { periodStart: string | null; periodEnd: string | null; openingBalance: Paise | null; closingBalance: Paise | null };

const rupees = (p: Paise) => `₹${Number(toDecimalString(p)).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function continuityFrom(
  parsed: Pick<ParsedStatement, "periodStart" | "periodEnd" | "openingBalance" | "closingBalance">,
  before: Neighbour | null,
  after: Neighbour | null,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!parsed.periodStart || !parsed.periodEnd) return { errors, warnings };

  if (before?.periodEnd && before.closingBalance !== null && parsed.openingBalance !== null) {
    if (addDays(before.periodEnd, 1) === parsed.periodStart) {
      if (before.closingBalance !== parsed.openingBalance) {
        errors.push(
          `Opening balance ${rupees(parsed.openingBalance)} does not match the ${rupees(before.closingBalance)} closing balance of the statement to ${before.periodEnd}`,
        );
      }
    } else if (before.periodEnd < parsed.periodStart) {
      warnings.push(`No statement covers ${addDays(before.periodEnd, 1)} → ${addDays(parsed.periodStart, -1)}: upload it to complete the account`);
    }
  }
  if (after?.periodStart && after.openingBalance !== null && parsed.closingBalance !== null) {
    if (addDays(parsed.periodEnd, 1) === after.periodStart) {
      if (after.openingBalance !== parsed.closingBalance) {
        errors.push(
          `Closing balance ${rupees(parsed.closingBalance)} does not match the ${rupees(after.openingBalance)} opening balance of the statement from ${after.periodStart}`,
        );
      }
    } else if (after.periodStart > parsed.periodEnd) {
      warnings.push(`No statement covers ${addDays(parsed.periodEnd, 1)} → ${addDays(after.periodStart, -1)}: upload it to complete the account`);
    }
  }
  return { errors, warnings };
}

/** The imported statements either side of this one's period, compared with it. */
export async function continuityProblems(integrationId: string, parsed: ParsedStatement): Promise<ValidationResult> {
  if (!parsed.periodStart || !parsed.periodEnd) return { errors: [], warnings: [] };
  const select = { periodStart: true, periodEnd: true, openingBalance: true, closingBalance: true } as const;
  const done = { in: ["PROCESSED", "NO_TRANSACTIONS"] };
  const [before, after] = await Promise.all([
    prisma.bankStatement.findFirst({
      where: { integrationId, status: done, periodEnd: { lt: toPrismaDate(parsed.periodStart) }, closingBalance: { not: null } },
      orderBy: { periodEnd: "desc" },
      select,
    }),
    prisma.bankStatement.findFirst({
      where: { integrationId, status: done, periodStart: { gt: toPrismaDate(parsed.periodEnd) }, openingBalance: { not: null } },
      orderBy: { periodStart: "asc" },
      select,
    }),
  ]);
  const toN = (s: typeof before): Neighbour | null =>
    s && {
      periodStart: s.periodStart ? fromPrismaDate(s.periodStart) : null,
      periodEnd: s.periodEnd ? fromPrismaDate(s.periodEnd) : null,
      openingBalance: fromDecimal(s.openingBalance),
      closingBalance: fromDecimal(s.closingBalance),
    };
  return continuityFrom(parsed, toN(before), toN(after));
}
