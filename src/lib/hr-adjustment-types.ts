/**
 * Ad-hoc salary-adjustment vocabulary. Kept dependency-free (no Prisma import)
 * so it can be shared by the server engine/API and by client components without
 * pulling the Prisma client into the browser bundle.
 *
 * `deduction` — comes off the pre-statutory salary (shown above ESI/PF/PT on the
 *               slip; it never changes the statutory amounts, per policy).
 * `addition`  — paid on top of the final net.
 */
export const ADJUSTMENT_KINDS = ["deduction", "addition"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_CATEGORIES = [
  "advance",
  "loan",
  "penalty",
  "arrears",
  "incentive",
  "bonus",
  "reimbursement",
  "other",
] as const;
export type AdjustmentCategory = (typeof ADJUSTMENT_CATEGORIES)[number];

export const ADJUSTMENT_CATEGORY_LABELS: Record<AdjustmentCategory, string> = {
  advance: "Advance recovery",
  loan: "Loan EMI",
  penalty: "Penalty / fine",
  arrears: "Arrears",
  incentive: "Incentive",
  bonus: "Bonus",
  reimbursement: "Reimbursement",
  other: "Other",
};

/** Typical direction for a category — a UI default only; either kind is allowed. */
export const ADJUSTMENT_CATEGORY_DEFAULT_KIND: Record<AdjustmentCategory, AdjustmentKind> = {
  advance: "deduction",
  loan: "deduction",
  penalty: "deduction",
  arrears: "addition",
  incentive: "addition",
  bonus: "addition",
  reimbursement: "addition",
  other: "deduction",
};
