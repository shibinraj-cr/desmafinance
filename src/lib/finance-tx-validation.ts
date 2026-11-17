import { z } from "zod";
import {
  TYPES,
  FLOWS,
  MONTHS,
  PAYMENT_MODES,
  flowFor,
  monthCodeFromDate,
  type TxType,
} from "./catalog";
import { verifyCategorySubItem } from "./master-data";
import { isCandidateParty, validateCounterparty } from "./tx-counterparty";
import {
  isBeforeHistoricalFloor,
  isCandidatePaymentCategory,
  isHistoricalDate,
} from "./finance-historical";
import type { TxProposed } from "./approval";

/**
 * Server-authoritative validation shared by every transaction write path —
 * create, edit, rejected-resubmit, and draft-edit. Centralising it means all
 * four paths enforce exactly the same rules, so a row can't slip in through a
 * weaker gate (e.g. a zero-amount resubmit, or a draft edit with an
 * unvalidated category).
 *
 * The `month` is ALWAYS derived from `date` here — the client value is never
 * trusted — so a stored transaction's month can never drift from its date and
 * the month-bucketed reports stay consistent.
 */

/**
 * Loose shape parse: gets well-typed primitives out of the request body and
 * rejects a totally malformed payload, while leaving the enum / master /
 * amount / counterparty semantics to {@link buildValidatedProposed} so every
 * write path reports the same specific error codes. `month` is intentionally
 * absent — it is derived server-side, not accepted from the client.
 */
export const RawTxFieldsSchema = z.object({
  date: z.string().min(1),
  type: z.string().min(1),
  category: z.string().min(1).max(120),
  subItem: z.string().min(1).max(160),
  description: z.string().max(500).optional().nullable(),
  paymentMode: z.string().min(1),
  amount: z.coerce.number(),
  flow: z.string().optional().nullable(),
  partyId: z.string().min(1).optional().nullable(),
  employeeId: z.string().min(1).optional().nullable(),
  expDom: z.enum(["EXP", "DOM"]).optional().nullable(),
});

export type RawTxFields = z.infer<typeof RawTxFieldsSchema>;

const MAX_AMOUNT = 1_000_000_000;

/**
 * Validate and normalise a transaction payload. Returns a ready-to-store
 * `TxProposed` on success, or `{ error }` with a stable code on failure.
 *
 * Enforces (identically for every write path):
 *   - date parses to a real calendar date;
 *   - month derived from date AND inside the tracked window;
 *   - type is a valid enum;
 *   - category / sub-item exist in the master for that type;
 *   - payment mode is a valid enum;
 *   - amount is a positive, finite number within bounds (rejects zero);
 *   - flow is a valid enum when supplied, else derived from type;
 *   - a counterparty (party or employee) is present and valid;
 *   - EXP/DOM is mandatory for Revenue and forced null for Expense.
 *
 * A date before DesGro's ledger began (1 Apr 2026) is a historical candidate
 * payment (see `finance-historical.ts`): accepted back to 1 Apr 2023, and only
 * as Sales/Collection revenue from a Candidate. When editing an existing row,
 * pass `existingIsHistorical` so an edit can't move a row across that date.
 */
export async function buildValidatedProposed(
  input: RawTxFields,
  opts?: { allowInactiveEmployeeId?: string | null; existingIsHistorical?: boolean },
): Promise<{ error: string } | { proposed: TxProposed }> {
  // Date must parse to a real calendar date.
  const parsedDate = new Date(input.date);
  if (isNaN(parsedDate.getTime())) return { error: "invalid_date" };

  // Month is derived from the date — never trusted from the client. A live
  // row must fall inside the tracked reporting window; a historical one only
  // has to be on or after the historical floor.
  const month = monthCodeFromDate(parsedDate);
  const historical = isHistoricalDate(parsedDate);
  if (historical) {
    if (isBeforeHistoricalFloor(parsedDate)) return { error: "historical_too_old" };
  } else if (!(MONTHS as readonly string[]).includes(month)) {
    return { error: "month_out_of_range" };
  }
  if (opts?.existingIsHistorical !== undefined && opts.existingIsHistorical !== historical) {
    return { error: "historical_kind_change" };
  }

  // Type enum.
  if (!(TYPES as readonly string[]).includes(input.type)) {
    return { error: "invalid_type" };
  }
  const type = input.type as TxType;

  // Before DesGro, only money received from candidates may be entered.
  if (historical && (type !== "Revenue" || !isCandidatePaymentCategory(input.category))) {
    return { error: "historical_payments_only" };
  }

  // Payment mode enum.
  if (!(PAYMENT_MODES as readonly string[]).includes(input.paymentMode)) {
    return { error: "invalid_payment_mode" };
  }

  // Amount must be a positive, finite number within bounds. This is the guard
  // that rejects zero-amount (re)submits.
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_AMOUNT) {
    return { error: "invalid_amount" };
  }

  // Flow: accept a valid enum from the client, otherwise derive from the type.
  let flow: string;
  if (input.flow == null || input.flow === "") {
    flow = flowFor(type);
  } else if ((FLOWS as readonly string[]).includes(input.flow)) {
    flow = input.flow;
  } else {
    return { error: "invalid_flow" };
  }

  // Category + sub-item validated against the DB master for this type.
  const verr = await verifyCategorySubItem(input.category, input.subItem, type);
  if (verr) return { error: verr };

  // EXP/DOM required on Revenue, forced null on Expense.
  const expDom = type === "Revenue" ? (input.expDom ?? null) : null;
  if (type === "Revenue" && expDom !== "EXP" && expDom !== "DOM") {
    return { error: "expDom_required" };
  }

  // A counterparty (party or employee) is mandatory on every transaction.
  const cerr = await validateCounterparty({
    type,
    partyId: input.partyId,
    employeeId: input.employeeId,
    allowInactiveEmployeeId: opts?.allowInactiveEmployeeId,
  });
  if (cerr) return { error: cerr };
  if (historical && (!input.partyId || !(await isCandidateParty(input.partyId)))) {
    return { error: "historical_candidate_only" };
  }

  return {
    proposed: {
      date: input.date,
      month,
      type,
      category: input.category,
      subItem: input.subItem,
      description: input.description ?? null,
      paymentMode: input.paymentMode,
      amount: input.amount,
      flow,
      partyId: input.partyId ?? null,
      employeeId: input.employeeId ?? null,
      expDom,
    },
  };
}
