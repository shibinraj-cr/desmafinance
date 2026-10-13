/**
 * Merge keys — the CRM values a template field can be filled from.
 *
 * A field with a merge key is filled in when the agreement is sent and is
 * read-only for the signer. This file is the one place that says where each
 * value comes from in Desgro, so the send wizard (Phase 2) resolves them from
 * here rather than each caller guessing.
 *
 * `from` is honest about coverage. Several values a nursing agreement needs —
 * address, passport number, registration number, instalments — are not
 * captured anywhere in Desgro yet; those are "manual": the send wizard asks
 * staff to type them, and they are still locked for the signer.
 */

export type MergeKeySource =
  /** A column on the CRM Lead (dotted path for a relation). */
  | { kind: "lead"; path: string }
  /** Computed from other values at send time. */
  | { kind: "derived"; rule: string }
  /** Not stored in Desgro; typed by staff in the send wizard. */
  | { kind: "manual" };

export type MergeKeyDef = {
  key: string;
  label: string;
  group: "Client" | "Deal" | "Other";
  from: MergeKeySource;
};

export const MERGE_KEYS: readonly MergeKeyDef[] = [
  { key: "client.full_name", label: "Client full name", group: "Client", from: { kind: "lead", path: "candidateName" } },
  { key: "client.email", label: "Client email", group: "Client", from: { kind: "lead", path: "email" } },
  { key: "client.phone", label: "Client phone", group: "Client", from: { kind: "lead", path: "phone" } },
  { key: "client.address", label: "Client address", group: "Client", from: { kind: "manual" } },
  { key: "client.passport_no", label: "Passport number", group: "Client", from: { kind: "manual" } },
  { key: "client.dob", label: "Date of birth", group: "Client", from: { kind: "lead", path: "dob" } },
  {
    key: "client.registration_no",
    label: "Registration number (nursing council / AHPRA)",
    group: "Client",
    from: { kind: "manual" },
  },
  { key: "deal.service_name", label: "Service", group: "Deal", from: { kind: "lead", path: "service.name" } },
  { key: "deal.fee_amount", label: "Fee amount", group: "Deal", from: { kind: "lead", path: "expectedValue" } },
  {
    key: "deal.fee_in_words",
    label: "Fee in words",
    group: "Deal",
    from: { kind: "derived", rule: "deal.fee_amount written out in Indian English (lakh / crore)" },
  },
  // GST treatment differs per service (inclusive, exclusive, exempt), so it is
  // confirmed by staff rather than computed from a single rate.
  { key: "deal.gst_amount", label: "GST amount", group: "Deal", from: { kind: "manual" } },
  {
    key: "deal.total_amount",
    label: "Total amount",
    group: "Deal",
    from: { kind: "derived", rule: "deal.fee_amount + deal.gst_amount" },
  },
  { key: "deal.installments", label: "Instalment schedule", group: "Deal", from: { kind: "manual" } },
  { key: "today", label: "Date sent", group: "Other", from: { kind: "derived", rule: "send date, Asia/Kolkata" } },
  { key: "staff.name", label: "DESMA staff name", group: "Other", from: { kind: "derived", rule: "the sending user" } },
];

export const MERGE_KEY_SET: ReadonlySet<string> = new Set(MERGE_KEYS.map((k) => k.key));

export function mergeKeyLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return MERGE_KEYS.find((k) => k.key === key)?.label ?? key;
}
