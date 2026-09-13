import { z } from "zod";
import { LIABILITY_KINDS, SELECTABLE_ASSET_CLASSES } from "./wealth-model";
import { WEALTH_FREQUENCIES } from "./wealth-reminders";

/**
 * Request shapes for the Personal Wealth API. Kept in one file so the create
 * and update forms cannot drift apart, and so every route validates money the
 * same way: a finite, non-negative number below the Decimal(14,2) ceiling.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Decimal(14,2) tops out below 10^12; reject anything that would overflow the
 *  column rather than letting Postgres raise a numeric field overflow. */
const MAX_AMOUNT = 999_999_999_999;

const money = z
  .number()
  .finite()
  .min(0, "Amount cannot be negative")
  .max(MAX_AMOUNT, "Amount is too large");

const optionalMoney = money.nullable().optional();
const optionalText = z.string().trim().max(2000).nullable().optional();
const shortText = z.string().trim().max(200).nullable().optional();

export const HoldingCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the holding a name").max(200),
  assetClass: z.enum(SELECTABLE_ASSET_CLASSES as [string, ...string[]]),
  scope: z.enum(["personal", "business"]).default("personal"),
  holderLabel: z.string().trim().min(1).max(80).default("Self"),
  institution: shortText,
  policyNo: shortText,
  investedAmount: optionalMoney,
  contributionAmount: optionalMoney,
  frequency: z.enum(WEALTH_FREQUENCIES as [string, ...string[]]).default("none"),
  dueDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  renewalOn: DATE.nullable().optional(),
  termYears: z.number().int().min(0).max(100).nullable().optional(),
  sumAssured: optionalMoney,
  reminderLeadDays: z.number().int().min(0).max(365).default(7),
  portalUrl: z.string().trim().max(500).nullable().optional(),
  portalUsername: z.string().trim().max(200).nullable().optional(),
  /** Plaintext in, ciphertext at rest. "" clears a stored password. */
  portalPassword: z.string().max(500).nullable().optional(),
  notes: optionalText,
  /** Optional opening valuation, so adding a holding is a single step. */
  value: optionalMoney,
  valuedOn: DATE.nullable().optional(),
});

export const HoldingUpdateSchema = HoldingCreateSchema.partial();

export const ValuationSchema = z.object({
  value: money,
  asOn: DATE,
  note: z.string().trim().max(300).nullable().optional(),
});

export const LiabilityCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the borrowing a name").max(200),
  kind: z.enum(LIABILITY_KINDS as unknown as [string, ...string[]]).default("other"),
  scope: z.enum(["personal", "business"]).default("personal"),
  lender: shortText,
  principal: optionalMoney,
  outstanding: money.default(0),
  interestRate: z.number().min(0).max(100).nullable().optional(),
  emiAmount: optionalMoney,
  emiDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  startedOn: DATE.nullable().optional(),
  tenureMonths: z.number().int().min(0).max(600).nullable().optional(),
  notes: optionalText,
  closed: z.boolean().optional(),
});

export const LiabilityUpdateSchema = LiabilityCreateSchema.partial();

export const GoldCreateSchema = z.object({
  category: z.string().trim().min(1, "Give the piece a category").max(80),
  name: z.string().trim().min(1, "Give the piece a name").max(200),
  grams: z.number().finite().min(0).max(1_000_000),
  holderLabel: z.string().trim().min(1).max(80).default("Self"),
  purityKarat: z.number().int().min(1).max(24).nullable().optional(),
  dueOn: DATE.nullable().optional(),
  notes: optionalText,
});

export const GoldUpdateSchema = GoldCreateSchema.partial();

export const SettingsSchema = z.object({
  goldRatePerGram: z.number().finite().min(0).max(1_000_000).optional(),
  goldRateAsOn: DATE.nullable().optional(),
  hideBusinessScope: z.boolean().optional(),
  remindersEnabled: z.boolean().optional(),
});

export const ReminderUpdateSchema = z.object({
  status: z.enum(["open", "paid", "skipped"]),
  paidOn: DATE.nullable().optional(),
  paidAmount: optionalMoney,
  notes: optionalText,
});
