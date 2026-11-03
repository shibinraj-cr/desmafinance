/**
 * Pulling a candidate's details out of the text of an Instagram DM.
 *
 * Pure functions only — no database, no Meta — so every rule here is pinned by
 * tests/ig-extract.test.ts. The ingest (src/lib/ig/ingest.ts) calls these on
 * each inbound message and keeps whatever is new.
 *
 * Rules over cleverness, on purpose. A candidate answering "please share your
 * name, phone number, email ID and qualification" writes one of a handful of
 * shapes ("Anjali, 9876543210, anjali@gmail.com, BSc Nursing", or the same over
 * three messages), and a rule that reads those reliably beats a model that
 * reads everything plausibly. What a rule misses stays in the message, where
 * the BDE can still read it.
 */
import { emailKeyOf, isOtherQualification, normalizePhone } from "../crm";

export type QualOption = { id: string; label: string };

export type ExtractedDetails = {
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  typedName: string | null;
  qualificationId: string | null;
};

/** The fields auto-ask chases. Name is not one: the Instagram profile already carries one. */
export type DetailField = "phone" | "email" | "qualification";

// Local part, then a dotted domain ending in a 2+ letter TLD. Anchored on a
// non-address character so "@desma.official" (a mention) never reads as one.
const EMAIL_RE = /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;

// A run of digits with the separators people type between them. Bounded so a
// whole paragraph of numbers cannot read as one phone.
const PHONE_RE = /(?:\+|\b)\d[\d\s\-().]{6,20}\d/g;

/** First email address in the text, trimmed of trailing punctuation. */
export function extractEmail(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(EMAIL_RE);
  if (!m) return null;
  return m[0].replace(/[.\-]+$/, "");
}

function withoutEmails(text: string): string {
  return text.replace(EMAIL_RE, " ");
}

/**
 * First phone number in the text, as typed and as E.164.
 *
 * Emails are cut out first — "anjali9876543210@gmail.com" carries a perfectly
 * good-looking mobile number that is not one. Fewer than 10 digits is a year,
 * a date or a pin code, never a mobile, so those runs are skipped. Normalised
 * by the CRM's own `normalizePhone` (bare 10 digits = India), so a number typed
 * here matches the same candidate typed anywhere else.
 */
export function extractPhone(text: string | null | undefined): { raw: string; e164: string } | null {
  if (!text) return null;
  for (const m of withoutEmails(text).matchAll(PHONE_RE)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) continue;
    const e164 = normalizePhone(raw);
    if (e164) return { raw, e164 };
  }
  return null;
}

/** Lowercase, drop dots and apostrophes ("B.Sc" → "bsc", "Bachelor's" → "bachelors"), collapse the rest to spaces. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The qualification the text names, from the CRM's own list.
 *
 * Whole-word containment of each label, longest label first — so "Post BSc
 * Nursing" wins over "BSc Nursing" when both are in the list and the candidate
 * wrote the longer one. A plural label also matches its singular ("Master's" ↔
 * "master"). The catch-all "Others" is never matched from text: it means "not
 * on the list", which no sentence can tell us.
 */
export function matchQualification(text: string | null | undefined, options: QualOption[]): QualOption | null {
  if (!text) return null;
  const hay = ` ${normalizeForMatch(text)} `;
  if (!hay.trim()) return null;

  const candidates = options
    .filter((o) => !isOtherQualification(o.label))
    .map((o) => ({ option: o, norm: normalizeForMatch(o.label) }))
    .filter((c) => c.norm.length > 0)
    .sort((a, b) => b.norm.length - a.norm.length);

  for (const c of candidates) {
    const forms = [c.norm];
    if (c.norm.endsWith("s") && c.norm.length > 3) forms.push(c.norm.slice(0, -1));
    if (forms.some((f) => hay.includes(` ${f} `))) return c.option;
  }
  return null;
}

/** Quick-reply payload carried by the qualification buttons auto-ask offers. */
export const QUAL_PAYLOAD_PREFIX = "desgro_qual:";

export function qualificationPayload(id: string): string {
  return `${QUAL_PAYLOAD_PREFIX}${id}`;
}

/** The qualification a tapped button names — only if it is still on the list. */
export function qualificationFromPayload(payload: string | null | undefined, options: QualOption[]): QualOption | null {
  if (!payload || !payload.startsWith(QUAL_PAYLOAD_PREFIX)) return null;
  const id = payload.slice(QUAL_PAYLOAD_PREFIX.length);
  return options.find((o) => o.id === id) ?? null;
}

// Words that are a message's framing, not a name. A segment made ONLY of these
// ("Hi sir", "I want details") is skipped over; a segment that contains any of
// them is never a name — "my friend's number is …" is not a person called
// Friend's. Deliberately generous: a missed name falls back to the Instagram
// profile name, while a wrong one becomes the lead's name.
const NOT_A_NAME = new Set([
  // greetings and address
  "hi", "hii", "hiii", "hello", "hey", "dear", "sir", "madam", "mam", "maam", "good", "morning", "evening",
  "afternoon", "ok", "okay", "yes", "no", "sure", "thanks", "thank", "you", "please", "pls", "plz", "kindly",
  // the labels people type in front of a value
  "name", "full", "my", "is", "phone", "mobile", "number", "contact", "email", "mail", "id", "whatsapp",
  "qualification", "qualifications", "details", "detail", "here", "are", "the", "and", "i", "am", "im", "this",
  "myself", "me", "friend", "friends", "numbers",
  // what the message is about
  "nurse", "nursing", "interested", "want", "need", "info", "information", "know", "more", "about", "for", "to",
  "a", "an", "of", "in", "on", "at", "job", "jobs", "work", "apply", "applying", "course", "fees", "fee",
  "call", "back", "send", "share",
]);

const LABEL_PREFIX = /^(?:my\s+)?(?:full\s+)?(?:name|phone(?:\s*(?:no|number))?|mobile(?:\s*(?:no|number))?|mob|ph|contact(?:\s*(?:no|number))?|whatsapp(?:\s*(?:no|number))?|e-?mail(?:\s*id)?|mail\s*id|qualification)\s*(?:is\s*)?[:\-–=]?\s*/i;

// What may sit in front of a name without being part of it: "Hi, I am Anjali",
// "Hello sir, this is Anjali", "Myself Anjali". Nothing else is stripped.
const LEADING_FRAMING =
  /^(?:(?:hi+|hello|hey|dear|good\s+(?:morning|afternoon|evening))[\s,!.]*)*(?:(?:sir|madam|ma['’]?am|mam)[\s,!.]*)?(?:(?:i\s+am|i['’]?m|this\s+is|myself|my\s+name\s+is)\s+)?/i;
const TRAILING_FRAMING = /[\s,!.]*(?:here|sir|madam|ma['’]?am|mam)$/i;

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function asName(segment: string, options: QualOption[]): string | null {
  const whole = segment.replace(/\s+/g, " ").trim();
  // A qualification is checked on the WHOLE segment, before anything is cut
  // off it — "BSc Nursing" minus "nursing" would otherwise be a person called
  // Bsc.
  if (!whole || matchQualification(whole, options)) return null;
  const s = whole
    .replace(LEADING_FRAMING, "")
    .replace(TRAILING_FRAMING, "")
    .trim()
    .replace(/^[\s.:\-–]+|[\s.:\-–]+$/g, "");
  if (s.length < 2 || s.length > 40) return null;
  // Letters, spaces, dots and apostrophes only — a digit or an @ means this
  // segment is something else.
  if (!/^[A-Za-z][A-Za-z .'’]*$/.test(s)) return null;
  const words = s.split(" ").filter(Boolean);
  if (words.length > 4) return null;
  if (words.some((w) => NOT_A_NAME.has(normalizeForMatch(w)))) return null;
  return titleCase(s);
}

function isFramingOnly(segment: string): boolean {
  return normalizeForMatch(segment)
    .split(" ")
    .every((w) => !w || NOT_A_NAME.has(w));
}

/**
 * The name a candidate typed, if they typed one.
 *
 * Two shapes are read: an explicit "name: Anjali" / "my name is Anjali", and
 * the bare first item of a details message ("Anjali, 9876543210, …"). The
 * second only counts when the message also carries a phone or an email — on
 * its own, "Thomas Cook" is as likely a question as a name. For the same
 * reason a bare "I am …" is never read as one: "I am interested" and "I am a
 * nurse" are far more common than "I am Anjali". Inside a details message the
 * greeting is trimmed ("Hi, I am Anjali, 98765…" → Anjali).
 */
export function extractTypedName(text: string | null | undefined, options: QualOption[] = []): string | null {
  if (!text) return null;

  const explicit = text.match(/(?:my\s+name\s+is|\bname\s*(?:is)?\s*[:\-–=])\s*([A-Za-z][A-Za-z .'’]{1,40})/i);
  if (explicit) {
    // Stop at the first connective, so "my name is Anjali and my number is…"
    // keeps only the name.
    const cut = explicit[1].split(/\s+(?:and|my|phone|mobile|number|email|from)\b/i)[0];
    const name = asName(cut, options);
    if (name) return name;
  }

  const hasContact = !!extractEmail(text) || !!extractPhone(text);
  if (!hasContact) return null;

  // Only the FIRST segment that says anything is a name candidate: in
  // "Anjali, Kerala, 9876543210" the place is not the person. A segment that
  // is only framing ("Hi,", "I want details") or a qualification is skipped
  // over, not counted.
  const stripped = withoutEmails(text).replace(PHONE_RE, " ");
  for (const raw of stripped.split(/[,\n;|/]+/)) {
    const seg = raw.replace(LABEL_PREFIX, "").trim();
    if (!seg) continue;
    const name = asName(seg, options);
    if (name) return name;
    if (!isFramingOnly(seg) && !matchQualification(seg, options)) return null;
  }
  return null;
}

/** Everything one message tells us. A tapped qualification button beats the text. */
export function extractDetails(
  input: { text: string | null | undefined; quickReplyPayload?: string | null },
  options: QualOption[],
): ExtractedDetails {
  const phone = extractPhone(input.text);
  const qual = qualificationFromPayload(input.quickReplyPayload, options) ?? matchQualification(input.text, options);
  return {
    email: extractEmail(input.text),
    phone: phone?.raw ?? null,
    phoneE164: phone?.e164 ?? null,
    typedName: extractTypedName(input.text, options),
    qualificationId: qual?.id ?? null,
  };
}

export type ContactDetails = {
  typedName: string | null;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  qualificationId: string | null;
};

/**
 * What to write onto the contact: blanks only.
 *
 * A candidate who gave their number in message two and mentions a friend's in
 * message five has still given theirs — the first answer stands. Returns an
 * empty object when the message adds nothing.
 */
export function newDetails(current: ContactDetails, found: ExtractedDetails): Partial<ContactDetails> {
  const patch: Partial<ContactDetails> = {};
  if (!current.typedName && found.typedName) patch.typedName = found.typedName;
  if (!emailKeyOf(current.email) && found.email) patch.email = found.email;
  if (!current.phoneE164 && found.phoneE164) {
    patch.phone = found.phone;
    patch.phoneE164 = found.phoneE164;
  }
  if (!current.qualificationId && found.qualificationId) patch.qualificationId = found.qualificationId;
  return patch;
}

/** Which of phone / email / qualification are still unknown, in the order a person would ask. */
export function missingDetails(d: { phoneE164: string | null; email: string | null; qualificationId: string | null }): DetailField[] {
  const missing: DetailField[] = [];
  if (!d.phoneE164) missing.push("phone");
  if (!emailKeyOf(d.email)) missing.push("email");
  if (!d.qualificationId) missing.push("qualification");
  return missing;
}

/** Did this patch add one of the fields auto-ask is chasing? (A name alone does not.) */
export function addsChasedDetail(patch: Partial<ContactDetails>): boolean {
  return !!(patch.phoneE164 || patch.email || patch.qualificationId);
}
