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
  // Recording a collection against its plan (src/lib/collection-payment.ts).
  paid_in_future: "The date received can't be in the future.",
  utr_required: "Enter the UTR: the bank reference of the payment.",
  installment_not_pending: "This instalment isn't waiting for a payment any more. Refresh the page.",
  plan_not_active: "This collection plan is closed or cancelled.",
  party_inactive: "This candidate is inactive.",
  submit_fields_required: "Pick the category, sub-item, payment mode and EXP/DOM.",
  collection_not_due: "That instalment has already been received or cancelled.",
  collection_more_than_due:
    "This payment is more than the candidate still owes on the collection plan. Add an instalment for the extra on the plan first, or reject it.",
  duplicate_payment: "A payment with this UTR is already on the ledger for this candidate.",
  duplicate_payment_on_approve:
    "A payment with this UTR is already on the ledger for this candidate. Reject this entry, then link the existing one to the instalment from the collection plan.",
  plan_linked:
    "This entry is a payment recorded on a collection plan. To delete it or change its amount, date or candidate, use Undo payment on the plan.",
  pending_exists: "This instalment already has an entry waiting for approval.",
  resubmit_installment_closed:
    "The instalment this payment was for has been received or cancelled since. Dismiss this entry instead of resubmitting it.",
  not_undoable: "This payment can't be undone here.",
  not_latest: "Only the plan's most recent payment can be undone. Undo the later ones first.",
  plan_changed: "The plan has changed since this payment was recorded (an instalment was added, edited or removed), so it can't be undone automatically.",
  link_unavailable: "That entry can't be linked: it's deleted, for another candidate, not revenue, or already linked to an instalment.",
  commission_plan:
    "This plan follows a Partner Commissions invoice. Record the partner's payment on the invoice; the plan updates when it is approved.",
};

export function txErrorMessage(code: string | null | undefined, fallback = "Failed to save."): string {
  return (code && MESSAGES[code]) || fallback;
}
