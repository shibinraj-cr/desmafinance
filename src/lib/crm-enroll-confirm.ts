/**
 * The Enroll sheet's rules, pure and client-safe: the sheet runs them live,
 * the enroll and edit routes enforce them, and Finance's verification screen
 * shows the same change log.
 *
 * An enrollment is the BDE's word on four things:
 *   - who: the name exactly as on the passport, and where they live (the
 *     invoice's bill-to; an Indian state decides CGST + SGST or IGST);
 *   - what: the service and the total the candidate pays, GST included;
 *   - the first payment: amount, the day it landed, the account, its UTR,
 *     and who paid;
 *   - the balance plan.
 * Finance checks it against the bank and approves it into the ledger
 * (src/lib/crm-enrollment.ts). Money is in rupees; dates are IST calendar
 * days as `YYYY-MM-DD`, so string order is date order.
 */
import { z } from "zod";
import { PAYMENT_MODES } from "./catalog";
import { enrollDateMessage, enrollDateProblem, formatEnrollDate } from "./crm-enroll-date";
import { gstStateByName } from "./invoices/gst-states";
import { isIndia } from "./invoices/core";

/** No money, no enrollment: the least a first payment may be without the sales head's approval. */
export const MIN_FIRST_PAYMENT = 10_000;

/** The accounts a candidate pays into. Anything else is "Other" (UPI, cash, card, RCS, STR). */
export const ENROLL_BANKS = ["Axis Bank", "HDFC Bank", "Wio Bank"] as const;
export const OTHER_PAYMENT_MODES = PAYMENT_MODES.filter((m) => !(ENROLL_BANKS as readonly string[]).includes(m));

export const PAYER_RELATIONS = [
  { code: "candidate", label: "The candidate" },
  { code: "parent", label: "Parent" },
  { code: "spouse", label: "Spouse" },
  { code: "other", label: "Someone else" },
] as const;
export type PayerRelation = (typeof PAYER_RELATIONS)[number]["code"];

/** Most instalments a balance plan may have. */
export const MAX_PLAN_ROWS = 12;

/** A transfer into a bank, or a UPI payment, has a reference Finance matches on the statement. */
export function utrRequired(mode: string | null | undefined): boolean {
  return mode === "Axis Bank" || mode === "HDFC Bank" || mode === "Wio Bank" || mode === "UPI";
}

export const belowMinimum = (firstAmount: number | null | undefined): boolean =>
  firstAmount != null && firstAmount > 0 && firstAmount < MIN_FIRST_PAYMENT;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const balanceOf = (total: number, first: number): number => r2(total - first);

/** The suggested EXP/DOM: a candidate living in India is domestic. Wio is always DOM (DLLC). */
export function suggestedExpDom(country: string | null | undefined, paymentMode: string | null | undefined): "DOM" | "EXP" {
  if (paymentMode === "Wio Bank") return "DOM";
  return isIndia(country ?? "India") ? "DOM" : "EXP";
}

// ── the balance plan ─────────────────────────────────────────────────────────

export type PlanRow = { date: string; amount: number };

/** `iso` plus `n` months, on the same day or the month's last day (31 Jan + 1 → 28 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/**
 * The balance in `count` monthly instalments from the month after `from`.
 * Whole rupees each; the last one takes what's left, so they always add up.
 */
export function splitBalance(balance: number, count: number, from: string): PlanRow[] {
  if (!(balance > 0) || !(count >= 1)) return [];
  const each = Math.floor(balance / count);
  return Array.from({ length: count }, (_, i) => ({
    date: addMonths(from, i + 1),
    amount: i === count - 1 ? r2(balance - each * (count - 1)) : each,
  }));
}

export const planTotal = (plan: PlanRow[]): number => r2(plan.reduce((s, p) => s + p.amount, 0));

/** A stored plan (JSON) as rows; anything malformed is dropped. */
export function parsePlan(json: unknown): PlanRow[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((r) => {
    const date = (r as { date?: unknown })?.date;
    const amount = Number((r as { amount?: unknown })?.amount);
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && amount > 0 ? [{ date, amount }] : [];
  });
}

// ── the confirmation ─────────────────────────────────────────────────────────

/** A real calendar day: "2026-02-30" is refused, not rolled into March. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Pick a real date.");
/** Rupees to the paisa, within what the ledger column holds. */
const MAX_AMOUNT = 1_000_000_000;
const money = z.coerce
  .number()
  .refine((n) => Number.isFinite(n) && Math.abs(n) <= MAX_AMOUNT, "That amount is too large.")
  .transform((n) => Math.round((n + Number.EPSILON) * 100) / 100);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const EnrollConfirmSchema = z.object({
  billingName: z.string().trim().max(120),
  billingCountry: z.string().trim().max(60),
  billingState: optText(60),
  billingAddress: optText(400),
  billingPin: optText(12),
  totalAmount: money,
  firstAmount: money,
  paidOn: isoDate,
  paymentMode: z.enum(PAYMENT_MODES),
  utr: optText(40),
  payerRelation: z.enum(["candidate", "parent", "spouse", "other"]),
  payerName: optText(120),
  plan: z.array(z.object({ date: isoDate, amount: money })).max(MAX_PLAN_ROWS),
});
export type EnrollConfirm = z.output<typeof EnrollConfirmSchema>;

export type ConfirmProblem = { field: keyof EnrollConfirm; message: string };

const inr = (n: number) => `₹${r2(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Everything wrong with a confirmation, in the sheet's order. `dateWindow`
 * applies the enrollment-date window (src/lib/crm-enroll-date.ts), which
 * binds the BDE; Finance correcting a date only can't put it in the future.
 */
export function confirmProblems(
  c: EnrollConfirm,
  opts: { today: string; canBackdate: boolean; dateWindow: boolean },
): ConfirmProblem[] {
  const out: ConfirmProblem[] = [];
  const add = (field: keyof EnrollConfirm, message: string) => out.push({ field, message });

  if (!c.billingName.trim()) add("billingName", "Enter the candidate's name exactly as on the passport.");
  if (!c.billingCountry.trim()) add("billingCountry", "Enter the country the candidate lives in.");
  else if (isIndia(c.billingCountry) && !gstStateByName(c.billingState)) {
    add("billingState", "Pick the candidate's state: it decides which GST applies.");
  }
  if (!(c.totalAmount > 0)) add("totalAmount", "Enter the total the candidate pays, GST included.");
  if (!(c.firstAmount > 0)) add("firstAmount", "Enter the first payment.");
  else if (c.totalAmount > 0 && c.firstAmount > c.totalAmount) add("firstAmount", "The first payment can't be more than the total.");

  if (c.paidOn > opts.today) add("paidOn", "The payment date can't be in the future.");
  else if (opts.dateWindow) {
    const problem = enrollDateProblem(c.paidOn, opts.today, { canBackdate: opts.canBackdate });
    if (problem) add("paidOn", enrollDateMessage(problem, opts.today));
  }
  if (utrRequired(c.paymentMode) && (c.utr ?? "").replace(/\s/g, "").length < 4) {
    add("utr", "Enter the UTR: the bank reference on the payment screenshot.");
  }
  if (c.payerRelation !== "candidate" && !c.payerName) add("payerName", "Enter the name of the person who paid.");

  const balance = c.totalAmount > 0 && c.firstAmount > 0 ? balanceOf(c.totalAmount, c.firstAmount) : 0;
  c.plan.forEach((row, i) => {
    if (!(row.amount > 0)) add("plan", `Enter an amount for instalment ${i + 2}.`);
    if (row.date < c.paidOn) add("plan", `Instalment ${i + 2} is dated before the first payment.`);
  });
  if (balance > 0 && c.plan.length === 0) add("plan", `Plan the balance of ${inr(balance)}: pick 1, 2 or 3 instalments.`);
  else if (c.plan.length && Math.abs(planTotal(c.plan) - balance) >= 0.005) {
    add("plan", `The instalments add up to ${inr(planTotal(c.plan))}, but the balance is ${inr(Math.max(0, balance))}.`);
  }
  return out;
}

/**
 * The exception after the first payment changes. At or over the minimum
 * there is none. Under it, the sales head's approval holds while the amount
 * doesn't drop, and a rejection while it doesn't change; anything else goes
 * back to the sales head.
 */
export function nextException(
  current: string | null,
  prevFirst: number | null,
  nextFirst: number | null,
): "pending" | "approved" | "rejected" | null {
  if (!belowMinimum(nextFirst)) return null;
  if (current === "approved" && prevFirst != null && nextFirst != null && nextFirst >= prevFirst) return "approved";
  if (current === "rejected" && prevFirst === nextFirst) return "rejected";
  return "pending";
}

/**
 * What's wrong with Finance's version of an enrollment. Looser than the
 * BDE's sheet: Finance reads the bank, so no UTR is demanded, a date only
 * can't be in the future, and an enrollment from the older app may still
 * have no payment at all.
 */
export function financeProblems(f: EnrollmentFields, today: string): string[] {
  const out: string[] = [];
  if (!f.billingName.trim()) out.push("Enter the name exactly as on the passport.");
  if (!f.billingCountry.trim()) out.push("Enter the country the candidate lives in.");
  else if (isIndia(f.billingCountry) && !gstStateByName(f.billingState)) out.push("Pick the candidate's state: it decides which GST applies.");
  if (!(f.totalAmount > 0)) out.push("Enter the total the candidate pays, GST included.");
  if (f.firstAmount != null) {
    if (!(f.firstAmount > 0)) out.push("The first payment must be more than zero.");
    else if (f.firstAmount > f.totalAmount) out.push("The first payment can't be more than the total.");
  }
  if (f.paidOn && f.paidOn > today) out.push("The payment date can't be in the future.");
  if (f.paymentMode && !(PAYMENT_MODES as readonly string[]).includes(f.paymentMode)) out.push("Pick the account the money landed in.");
  if (f.payerRelation && !PAYER_RELATIONS.some((r) => r.code === f.payerRelation)) out.push("Pick who paid.");
  if (f.expDom != null && f.expDom !== "EXP" && f.expDom !== "DOM") out.push("Pick EXP or DOM.");
  if (f.plan.length > MAX_PLAN_ROWS) out.push(`A plan can have at most ${MAX_PLAN_ROWS} instalments.`);
  f.plan.forEach((row, i) => {
    if (!(row.amount > 0)) out.push(`Enter an amount for instalment ${i + 2}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) out.push(`Pick a date for instalment ${i + 2}.`);
    else if (f.paidOn && row.date < f.paidOn) out.push(`Instalment ${i + 2} is dated before the first payment.`);
  });
  if (f.firstAmount != null && f.firstAmount > 0 && f.totalAmount > 0) {
    const balance = balanceOf(f.totalAmount, f.firstAmount);
    if (Math.abs(planTotal(f.plan) - Math.max(0, balance)) >= 0.005) {
      out.push(`The instalments add up to ${inr(planTotal(f.plan))}, but the balance is ${inr(Math.max(0, balance))}.`);
    }
  }
  return out;
}

// ── the change log ───────────────────────────────────────────────────────────

/** What an enrollment says, as compared and shown in the change log. */
export type EnrollmentFields = {
  billingName: string;
  billingCountry: string;
  billingState: string | null;
  billingAddress: string | null;
  billingPin: string | null;
  totalAmount: number;
  firstAmount: number | null;
  paidOn: string | null;
  paymentMode: string | null;
  utr: string | null;
  payerRelation: string | null;
  payerName: string | null;
  plan: PlanRow[];
  /** Finance's: the ledger classification and EXP/DOM. */
  category?: string | null;
  subItem?: string | null;
  expDom?: string | null;
};

export const FIELD_LABELS: Record<keyof EnrollmentFields, string> = {
  billingName: "Name as on passport",
  billingCountry: "Country",
  billingState: "State",
  billingAddress: "Address",
  billingPin: "PIN",
  totalAmount: "Total",
  firstAmount: "First payment",
  paidOn: "Paid on",
  paymentMode: "Paid into",
  utr: "UTR",
  payerRelation: "Paid by",
  payerName: "Payer's name",
  plan: "Balance plan",
  category: "Category",
  subItem: "Sub-item",
  expDom: "EXP/DOM",
};

const FIELD_ORDER = Object.keys(FIELD_LABELS) as Array<keyof EnrollmentFields>;

export function describePlan(plan: PlanRow[]): string {
  if (!plan.length) return "Paid in full";
  return plan.map((p) => `${inr(p.amount)} on ${formatEnrollDate(p.date)}`).join("; ");
}

/** One field's value as the change log prints it. */
export function formatField(field: keyof EnrollmentFields, f: EnrollmentFields): string {
  const v = f[field];
  if (field === "plan") return describePlan(f.plan);
  if (v == null || v === "") return "—";
  if (field === "totalAmount" || field === "firstAmount") return inr(Number(v));
  if (field === "paidOn") return formatEnrollDate(String(v));
  if (field === "payerRelation") return PAYER_RELATIONS.find((r) => r.code === v)?.label ?? String(v);
  return String(v);
}

export type FieldChange = { field: keyof EnrollmentFields; label: string; from: string; to: string };

const FINANCE_ONLY = { category: 1, subItem: 1, expDom: 1 } as const;

/** What changed between two versions, as "label: from → to". Finance's fields only when `after` has them. */
export function enrollmentChanges(before: EnrollmentFields, after: EnrollmentFields): FieldChange[] {
  return FIELD_ORDER.filter((k) => !(k in FINANCE_ONLY) || after[k] !== undefined).flatMap((field) => {
    const from = formatField(field, before);
    const to = formatField(field, after);
    return from === to ? [] : [{ field, label: FIELD_LABELS[field], from, to }];
  });
}

export function changeSummary(changes: FieldChange[]): string {
  return changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join("; ");
}

// ── status ───────────────────────────────────────────────────────────────────

export const ENROLLMENT_STATUSES = ["pending", "sent_back", "verified", "not_received", "withdrawn"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
/** Statuses Finance can still act on. */
export const OPEN_STATUSES: EnrollmentStatus[] = ["pending", "sent_back", "not_received"];

export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  pending: "Pending Finance",
  sent_back: "Sent back to BDE",
  verified: "Verified by Finance",
  not_received: "Money not received",
  withdrawn: "Withdrawn",
};

/** Why Finance can't approve yet, or null. */
export function approveBlocker(e: {
  status: string;
  exception: string | null;
  firstAmount: number | null;
  paidOn: string | null;
  paymentMode: string | null;
  category?: string | null;
  subItem?: string | null;
  expDom?: string | null;
}): string | null {
  if (e.status === "verified") return "This enrollment is already verified.";
  if (e.status === "withdrawn") return "This enrollment was withdrawn (un-enrolled).";
  if (e.exception === "pending") return `The first payment is under ${inr(MIN_FIRST_PAYMENT)}: the sales head has to approve the exception first.`;
  if (e.exception === "rejected") return `The sales head rejected the first payment under ${inr(MIN_FIRST_PAYMENT)}. The enrollment should be undone.`;
  if (!(e.firstAmount && e.firstAmount > 0) || !e.paidOn || !e.paymentMode) return "Fill in the first payment: amount, date and account.";
  if (!e.category || !e.subItem) return "Pick the ledger category and sub-item.";
  if (e.expDom !== "EXP" && e.expDom !== "DOM") return "Pick EXP or DOM.";
  return null;
}

// ── the incentive ────────────────────────────────────────────────────────────

/** The day of the next month by which Finance must verify a month's enrollments for its incentive. */
export const INCENTIVE_VERIFY_BY_DAY = 7;

/** End of the 7th of the month after (`year`, `month`), IST: the month's incentive cut-off. */
export function incentiveCutoff(year: number, month: number): Date {
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  return new Date(`${ny}-${String(nm).padStart(2, "0")}-${String(INCENTIVE_VERIFY_BY_DAY).padStart(2, "0")}T23:59:59.999+05:30`);
}

/**
 * How a won deal stands for its month's incentive:
 *   - counted: no confirmation on it (enrolled before verification existed),
 *     or Finance verified it by the cut-off;
 *   - awaiting: not verified yet, and the cut-off hasn't passed;
 *   - late: verified after the cut-off. Paid as an adjustment, not in the month;
 *   - missed: still not verified after the cut-off.
 */
export type IncentiveStanding = "counted" | "awaiting" | "late" | "missed";

export function incentiveStanding(
  e: { status: string; verifiedAt: Date | null } | null,
  cutoff: Date,
  now: Date,
): IncentiveStanding {
  if (!e) return "counted";
  if (e.status === "verified" && e.verifiedAt) return e.verifiedAt <= cutoff ? "counted" : "late";
  return now <= cutoff ? "awaiting" : "missed";
}

// ── Finance's edits ──────────────────────────────────────────────────────────

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

/** A partial change from Finance's review panel; omitted fields stay as they are. */
export const FinancePatchSchema = z.object({
  billingName: z.string().trim().max(120).optional(),
  billingCountry: z.string().trim().max(60).optional(),
  billingState: nullableText(60),
  billingAddress: nullableText(400),
  billingPin: nullableText(12),
  totalAmount: money.optional(),
  firstAmount: money.nullable().optional(),
  paidOn: isoDate.nullable().optional(),
  paymentMode: z.enum(PAYMENT_MODES).nullable().optional(),
  utr: nullableText(40),
  payerRelation: z.enum(["candidate", "parent", "spouse", "other"]).nullable().optional(),
  payerName: nullableText(120),
  plan: z.array(z.object({ date: isoDate, amount: money })).max(MAX_PLAN_ROWS).optional(),
  category: nullableText(120),
  subItem: nullableText(160),
  expDom: z.enum(["EXP", "DOM"]).nullable().optional(),
});
