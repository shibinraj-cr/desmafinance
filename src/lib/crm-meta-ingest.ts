// Pure mapping for the Meta lead-ads spreadsheet → CRM Lead ingestion.
//
// Each campaign is a sheet/tab; each row is a lead. Column headers differ
// between campaigns ("Name" vs "Full Name", "Phone" vs "Phone Number", …), so
// we resolve fields by a case-insensitive alias list rather than fixed indexes.
// Phone arrives as a number from Sheets (formatted as "9.x E+11" only for
// display) — `normalizePhone` extracts the digits.
import { createHash } from "node:crypto";
import { normalizePhone, emailKeyOf } from "./crm";

const NAME_KEYS = ["name", "full name", "candidate name", "candidate", "fullname"];
const EMAIL_KEYS = ["email", "email address", "e-mail", "mail", "email id"];
const PHONE_KEYS = ["phone", "phone number", "phone no", "mobile", "mobile number", "contact", "contact number", "number"];
const DATE_KEYS = ["date", "created", "created time", "lead date", "created_time"];

// Columns folded into first-class fields — excluded from the `extra` blob.
const CORE_KEYS = new Set([...NAME_KEYS, ...EMAIL_KEYS, ...PHONE_KEYS]);

export type MetaRow = Record<string, unknown>;

export type MappedMetaLead = {
  candidateName: string;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  emailKey: string | null;
  createdAt: Date | null;
  extra: Record<string, string>;
  externalKey: string;
};

function cell(row: MetaRow, lowerToActual: Map<string, string>, keys: string[]): string {
  for (const k of keys) {
    const actual = lowerToActual.get(k);
    if (actual !== undefined) {
      const v = row[actual];
      const s = v == null ? "" : String(v).trim();
      if (s) return s;
    }
  }
  return "";
}

/** Parse a Meta date string ("2026-05-27T05:47:32+0000") to a Date, or null. */
export function parseMetaDate(raw: string): Date | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t);
}

/**
 * Stable idempotency key for a Meta sheet row. Same row (same campaign + lead
 * date + identity) always hashes to the same value, so re-sends are skipped by
 * the unique `Lead.externalKey` constraint. The same person across *different*
 * campaigns yields different keys (both ingested; the second is then flagged a
 * duplicate by the email/phone dedupe).
 */
export function computeMetaExternalKey(parts: {
  campaign: string;
  dateISO: string | null;
  emailKey: string | null;
  phoneE164: string | null;
  name: string;
}): string {
  const basis = [
    "meta",
    parts.campaign.trim().toLowerCase(),
    parts.dateISO ?? "",
    parts.emailKey ?? "",
    parts.phoneE164 ?? "",
    parts.name.trim().toLowerCase().replace(/\s+/g, " "),
  ].join("|");
  return "meta_" + createHash("sha1").update(basis).digest("hex");
}

/**
 * Map one spreadsheet row to a CRM lead. Returns null when the row has no
 * candidate name (caller counts it as an error/skipped row).
 */
export function mapMetaRow(campaign: string, row: MetaRow): MappedMetaLead | null {
  const lowerToActual = new Map<string, string>();
  for (const key of Object.keys(row)) {
    const norm = key.trim().toLowerCase();
    if (norm && !lowerToActual.has(norm)) lowerToActual.set(norm, key);
  }

  const candidateName = cell(row, lowerToActual, NAME_KEYS);
  if (!candidateName) return null;

  const email = cell(row, lowerToActual, EMAIL_KEYS) || null;
  const phone = cell(row, lowerToActual, PHONE_KEYS) || null;
  const phoneE164 = normalizePhone(phone);
  const emailKey = emailKeyOf(email);
  const dateRaw = cell(row, lowerToActual, DATE_KEYS);
  const createdAt = parseMetaDate(dateRaw);

  // Everything that isn't a core field (name/email/phone) is kept as context:
  // the questionnaire answers, Meta campaign/adset/ad, platform, city, etc.
  const extra: Record<string, string> = { campaign };
  for (const key of Object.keys(row)) {
    const norm = key.trim().toLowerCase();
    if (!norm || CORE_KEYS.has(norm)) continue;
    const v = row[key];
    const s = v == null ? "" : String(v).trim();
    if (s) extra[key.trim()] = s;
  }

  const externalKey = computeMetaExternalKey({
    campaign,
    dateISO: createdAt ? createdAt.toISOString() : (dateRaw || null),
    emailKey,
    phoneE164,
    name: candidateName,
  });

  return { candidateName, email, phone, phoneE164, emailKey, createdAt, extra, externalKey };
}
