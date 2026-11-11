/**
 * Candidate referral links — the pure half (no database, safe in client
 * components, unit-tested). The database side is src/lib/crm-referral.ts.
 *
 * Every lead can have one shareable link, https://<domain>/r/<code>. The
 * candidate posts it (often into WhatsApp groups); anyone who fills the form
 * behind it becomes a NEW lead with source "Referral Link", filed under the
 * candidate through `Lead.referredByLeadId`. Someone already in the CRM is
 * folded onto their existing lead as a re-inquiry and credited to nobody.
 */

/** No 0/O or 1/I/L, so a code read aloud or retyped from a poster survives. */
export const REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** 31^7 ≈ 27 billion codes: unguessable at this scale, short enough to type. */
export const REFERRAL_CODE_LENGTH = 7;

/** LeadPulseSource.code stamped on every lead the form creates (made by the 20261110160000 migration). */
export const REFERRAL_LINK_SOURCE_CODE = "referral_link";
export const REFERRAL_LINK_SOURCE_LABEL = "Referral Link";

/**
 * What became of one form sent through a link:
 *  - `created`  — a new lead, credited to the candidate;
 *  - `existing` — the person was already in the CRM: a re-inquiry, no credit;
 *  - `self`     — the candidate's own number or email: nothing happens;
 *  - `inactive` — a new lead through a switched-off link: kept, not credited.
 */
export const REFERRAL_OUTCOMES = ["created", "existing", "self", "inactive"] as const;
export type ReferralOutcome = (typeof REFERRAL_OUTCOMES)[number];

/** A fresh code. `randomInt(n)` must return an integer in [0, n) — crypto.randomInt on the server. */
export function generateReferralCode(randomInt: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * A code as it arrives in a URL → its stored (upper-case) form, or null when it
 * cannot be one. Lower case is accepted because people retype links.
 */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  if (code.length !== REFERRAL_CODE_LENGTH) return null;
  for (const ch of code) if (!REFERRAL_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function referralPath(code: string): string {
  return `/r/${code}`;
}

export function referralUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/$/, "")}${referralPath(code)}`;
}

const TITLES = /^(mr|mrs|ms|miss|dr|sr|sis|bro)\.?$/i;
const PLACEHOLDER_NAMES = /^(instagram|whatsapp|wa|insta|unknown|test)\s+lead$/i;

/**
 * The first name the public page greets with ("Asha invited you"), or null when
 * the lead's name can't be shown to a stranger as a name — a phone number, an
 * @handle, a placeholder a channel gave the lead. Only the first name ever
 * leaves the CRM.
 */
export function referrerFirstName(name: string | null | undefined): string | null {
  const full = (name ?? "").trim();
  if (!full || full.startsWith("@") || /\d/.test(full) || PLACEHOLDER_NAMES.test(full)) return null;
  const first = full.split(/\s+/).find((t) => !TITLES.test(t));
  if (!first) return null;
  const word = first.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  if (word.length < 2 || word.length > 30) return null;
  // "ASHA K" from a sheet import reads as shouting on the page.
  return word === word.toUpperCase() ? word[0] + word.slice(1).toLowerCase() : word;
}

/** The message a consultant sends the candidate along with their link. */
export function referralShareMessage(p: { firstName: string | null; url: string }): string {
  return [
    `Hi${p.firstName ? ` ${p.firstName}` : ""}, here is your personal DESMA referral link:`,
    p.url,
    "",
    "Share it with your friends and in your groups. Everyone who registers through it is recorded under your name.",
  ].join("\n");
}

/** wa.me link with the message ready: to the candidate's chat, or the contact picker when there's no number. */
export function whatsappShareHref(phoneE164: string | null | undefined, text: string): string {
  const digits = (phoneE164 ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

const NOT_A_PERSON = new RegExp(
  [
    "bot\\b|bot/|crawl|spider|slurp|preview",
    "facebookexternalhit|facebookcatalog|whatsapp|telegram|skype|discord",
    "headless|curl|wget|python-|okhttp|go-http|node-fetch|axios",
  ].join("|"),
  "i",
);

/**
 * User agents that open a page without being a person: link-preview fetchers
 * (WhatsApp, Facebook, Telegram…), crawlers and scripts. Their visits are not
 * counted. Belt and braces — the count comes from a beacon the page's script
 * sends, which most of these never run.
 */
export function isPreviewOrBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return true;
  return NOT_A_PERSON.test(ua);
}

/** Who sent the form, measured against the candidate whose link it was. */
export function classifyReferralSubmission(p: {
  referrer: { phoneKeys: string[]; emailKey: string | null };
  submitted: { phoneE164: string; emailKey: string | null };
  /** The oldest lead already holding the submitted phone or email, if any. */
  existingLeadId: string | null;
  linkActive: boolean;
}): ReferralOutcome {
  const ownPhone = p.referrer.phoneKeys.includes(p.submitted.phoneE164);
  const ownEmail = !!p.submitted.emailKey && p.submitted.emailKey === p.referrer.emailKey;
  if (ownPhone || ownEmail) return "self";
  if (p.existingLeadId) return "existing";
  return p.linkActive ? "created" : "inactive";
}

/** How a re-inquiry through someone's link reads on the timeline and in the bell. */
export function referralReInquirySource(referrerName: string): string {
  return `Referral link of ${referrerName.trim() || "a candidate"}`;
}

/** The candidate's numbers on the lead page card. */
export type ReferralTally = {
  /** Page opens by people (not link previews). */
  visits: number;
  /** New leads credited to the candidate. */
  leads: number;
  /** Of those, how many have enrolled. */
  enrolled: number;
  /** People who were already in the CRM — not credited. */
  existing: number;
};

export type ReferredLeadRow = {
  id: string;
  candidateName: string;
  createdAt: string;
  status: { code: string; label: string; color: string | null };
};

/** How many referred leads the lead page lists (the tally counts them all). */
export const REFERRED_LIST_LIMIT = 20;

/** Everything the lead page's referral card shows (loaded by loadLeadReferral). */
export type LeadReferralDTO = {
  link: { code: string; url: string; active: boolean } | null;
  tally: ReferralTally;
  /** Newest first, capped at {@link REFERRED_LIST_LIMIT}. */
  referred: ReferredLeadRow[];
  /** The candidate whose link brought THIS lead in. */
  referredBy: { id: string; candidateName: string } | null;
};
