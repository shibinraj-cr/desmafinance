/**
 * Plain-language messages for the error codes the transaction write paths
 * return (see `finance-tx-validation.ts`). Client-safe.
 */
const MESSAGES: Record<string, string> = {
  validation_failed: "Please check the values entered.",
  not_found: "Transaction no longer exists.",
  invalid_date: "Enter a valid date.",
  month_out_of_range: "That date is outside the current financial year (Apr 2026 – Mar 2027).",
  invalid_amount: "Enter an amount greater than zero.",
  expDom_required: "Choose EXP or DOM.",
  counterparty_required: "Select a party for this transaction.",
  party_not_found: "That party is inactive or no longer exists.",
  party_tx_type_mismatch: "That party isn't set up for this type of transaction.",
  category_not_found: "That category no longer exists.",
  sub_item_not_found: "That sub-item no longer exists.",
  historical_too_old: "Payments before DesGro can be dated 1 Apr 2023 at the earliest.",
  historical_payments_only:
    "Before 1 Apr 2026, only payments received from candidates (Sales or Collection) can be recorded.",
  historical_candidate_only: "A payment dated before 1 Apr 2026 must be from a candidate.",
  invoiced:
    "This payment has a GST invoice. Cancel the invoice in Finance › Invoices before changing its date, amount, bank, candidate or EXP/DOM, or deleting it.",
  not_reached: "Not reached in time. Press Process selected again.",
  already_resolved: "Already approved or rejected by someone else.",
  historical_kind_change:
    "This entry's date can't move across 1 Apr 2026, when DesGro's books began. Delete it and enter it again with the right date.",
};

export function txErrorMessage(code: string | null | undefined, fallback = "Failed to save."): string {
  return (code && MESSAGES[code]) || fallback;
}
