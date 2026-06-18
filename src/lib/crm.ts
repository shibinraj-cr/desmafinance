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
  // Bare 10-digit Indian mobile.
  if (digits.length === 10) return `+91${digits}`;
  // Leading domestic trunk 0 (e.g. 09876543210).
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  // 91XXXXXXXXXX.
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  // Anything else of a plausible international length — pass through.
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
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
