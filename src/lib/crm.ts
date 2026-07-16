// Shared CRM utilities (pure functions — safe to import anywhere, unit-tested).

/**
 * Normalise a raw phone string into an E.164-ish value usable for `wa.me`
 * and `tel:` links. India (+91) is assumed as the default country code since
 * the vast majority of leads are domestic; numbers already carrying a country
 * code (leading `+` or a recognised 11–15 digit form) are preserved.
 *
 * Returns `null` when the input cannot be normalised (so callers can fall back
 * to the raw string or disable WhatsApp).
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (hasPlus) {
    // Already international — keep as-is if it looks like a valid length.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // Strip a leading run of zeros before interpreting the number. A single 0 is a
  // domestic trunk prefix (09876543210); a run of them (00, 000, …) is an
  // international access code — the dialling equivalent of a leading '+'. E.164
  // numbers never carry leading zeros after the country code, so removing them is
  // safe and makes the same caller dialled as 9876543210 / 09876543210 /
  // 0097450361786 / 00091… collapse to one canonical value. That way a Voxbay
  // call written with leading zeros matches the country-coded number the CRM
  // stored (and vice-versa).
  const bare = digits.replace(/^0+/, "");
  if (!bare) return null;

  // A bare 10-digit number is assumed to be an Indian mobile (the default market).
  if (bare.length === 10) return `+91${bare}`;
  // Otherwise it already carries a country code (91XXXXXXXXXX, 97450361786,
  // 447911123456, …) — pass it through at any plausible international length.
  if (bare.length >= 11 && bare.length <= 15) return `+${bare}`;
  return null;
}

/**
 * Deterministic identity key for duplicate detection. Prefers the lowercased
 * email; falls back to the normalised E.164 phone. Returns `null` when neither
 * is present (such a lead cannot be deduped and is always treated as new).
 */
export function computeDedupeKey(
  email: string | null | undefined,
  phoneE164: string | null | undefined,
): string | null {
  const e = email?.trim().toLowerCase();
  if (e) return e;
  if (phoneE164) return phoneE164;
  return null;
}

/**
 * Email match key for duplicate detection: lowercased, trimmed email, or null
 * when absent/blank. A lead is flagged duplicate when its `emailKey` OR its
 * `phoneE164` collides with an existing lead — the two are matched
 * independently, so the same person caught by either field is detected.
 */
export function emailKeyOf(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/**
 * A lead's phone "identity set" for duplicate detection: the primary and
 * alternate normalised E.164 numbers, de-duplicated with blanks dropped. Two
 * records are the same candidate when these sets intersect — matched against
 * BOTH phone fields on each side, so an alternate number colliding with another
 * lead's primary (or vice-versa) is detected. Order-stable (primary first).
 */
export function phoneMatchKeys(
  phoneE164: string | null | undefined,
  altPhoneE164: string | null | undefined,
): string[] {
  const keys: string[] = [];
  if (phoneE164) keys.push(phoneE164);
  if (altPhoneE164 && altPhoneE164 !== phoneE164) keys.push(altPhoneE164);
  return keys;
}

/** Fallback pill colour for a status with no explicit `color`. */
export const DEFAULT_STATUS_COLOR = "#9aa0a6";

/** Render an email/whatsapp/call template with `{name}` / `{service}` / `{consultant}` merge fields. */
export function renderTemplate(
  template: string,
  vars: { name?: string | null; service?: string | null; consultant?: string | null },
): string {
  return template
    .replace(/\{name\}/g, vars.name ?? "")
    .replace(/\{service\}/g, vars.service ?? "")
    .replace(/\{consultant\}/g, vars.consultant ?? "");
}

/** Merge fields supported in bulk-email subjects/bodies (shown in the composer hint). */
export const BULK_EMAIL_MERGE_FIELDS = [
  "name",
  "first_name",
  "service",
  "consultant",
  "consultant_phone",
  "campaign",
  "qualification",
] as const;

// ── CRM message templates (email + WhatsApp) ────────────────────────────────
// Pure, client-safe definitions shared by the template manager, the single-lead
// composers, and the bulk composer. Server-only helpers (list/serialize against
// the DB) live in `crm-message-templates.ts`.

export type MessageChannel = "email" | "whatsapp";

/** A saved CRM message template, serialized for the client. */
export type MessageTemplateDTO = {
  id: string;
  channel: MessageChannel;
  name: string;
  /** Email subject line (merge fields allowed). Always null for WhatsApp. */
  subject: string | null;
  body: string;
  isActive: boolean;
  createdAt: string;
};

export type CrmMergeField = { token: string; label: string; sample: string };

/**
 * Merge tokens available in CRM email/WhatsApp templates. Rendered per-lead at
 * send time via {@link fillTemplate}. Token names here MUST match the keys
 * produced by {@link buildLeadMergeVars}.
 */
export const CRM_TEMPLATE_MERGE_FIELDS: CrmMergeField[] = [
  { token: "name", label: "Candidate name", sample: "Priya Menon" },
  { token: "first_name", label: "Candidate first name", sample: "Priya" },
  { token: "service", label: "Service of interest", sample: "AHPRA Direct" },
  { token: "consultant", label: "Consultant name", sample: "Aparna" },
  { token: "consultant_phone", label: "Consultant phone", sample: "+91 79949 20775" },
  { token: "campaign", label: "Campaign", sample: "Meta — RN Australia" },
  { token: "qualification", label: "Qualification", sample: "BSN" },
];

/** Sample values for previewing a template when no real lead is in context. */
export const CRM_TEMPLATE_SAMPLE_VARS: Record<string, string> = Object.fromEntries(
  CRM_TEMPLATE_MERGE_FIELDS.map((f) => [f.token, f.sample]),
);

/**
 * Build the `{token}` → value map for a single lead, used to render an
 * email/WhatsApp template. Keys must line up with {@link CRM_TEMPLATE_MERGE_FIELDS}.
 * Missing values render as an empty string (so an unset consultant phone just
 * drops out rather than leaving a literal `{consultant_phone}`).
 */
export function buildLeadMergeVars(input: {
  candidateName?: string | null;
  service?: string | null;
  consultant?: string | null;
  consultantPhone?: string | null;
  campaign?: string | null;
  qualification?: string | null;
}): Record<string, string> {
  const name = (input.candidateName ?? "").trim();
  return {
    name,
    first_name: name.split(/\s+/)[0] ?? "",
    service: input.service ?? "",
    consultant: input.consultant ?? "",
    consultant_phone: input.consultantPhone ?? "",
    campaign: input.campaign ?? "",
    qualification: input.qualification ?? "",
  };
}

/**
 * Fill a template against an arbitrary `{token}` map. Unknown tokens are left
 * verbatim (so a stray brace in the body doesn't silently vanish); known tokens
 * with no value become "". Case-insensitive on the token name.
 */
export function fillTemplate(template: string, vars: Record<string, string | null | undefined>): string {
  const lookup = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v ?? ""]));
  return template.replace(/\{([a-z0-9_]+)\}/gi, (whole, token: string) => {
    const key = token.toLowerCase();
    return lookup.has(key) ? String(lookup.get(key)) : whole;
  });
}
