/**
 * Pure helpers for reading a bank statement e-mail: does this message belong
 * to the integration, which period does it cover, and where is the statement
 * (a SmartStatement link, or an attached PDF). No I/O — the Gmail client
 * hands these the decoded message parts.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "06-Oct-2026" → "2026-10-06"; null if not a real date. */
export function parseDdMonYyyy(s: string): string | null {
  const m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return isoIfValid(Number(m[3]), mon, Number(m[1]));
}

export function isoIfValid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * "…for the period 06-Oct-2026 TO 06-Oct-2026" → both ends as ISO days.
 * Tolerates "to"/"TO"/"-" and extra spaces; null when no period is present.
 */
export function parseSubjectPeriod(subject: string): { start: string; end: string } | null {
  const m = /(\d{1,2}[-\s][A-Za-z]{3,9}[-\s]\d{4})\s*(?:TO|-|–)\s*(\d{1,2}[-\s][A-Za-z]{3,9}[-\s]\d{4})/i.exec(subject);
  if (!m) return null;
  const start = parseDdMonYyyy(m[1]);
  const end = parseDdMonYyyy(m[2]);
  if (!start || !end || start > end) return null;
  return { start, end };
}

/**
 * The integration's subject pattern with its account placeholder filled in.
 * Patterns may carry `{last4}` so one default works for every account.
 */
export function resolveSubjectPattern(pattern: string, last4: string): string {
  return pattern.replace(/\{last4\}/g, last4);
}

/** Address part of a From header: `"HDFC" <a@b.in>` → `a@b.in`. */
export function fromAddress(header: string): string {
  const m = /<([^>]+)>/.exec(header);
  return (m ? m[1] : header).trim().toLowerCase();
}

/**
 * Whether a message belongs to the integration. Sender must match exactly
 * (case-blind); the subject must CONTAIN the pattern — never compared whole,
 * because the period changes daily.
 */
export function matchesIntegration(
  msg: { from: string; subject: string },
  rule: { sender: string; subjectPattern: string; last4: string },
): boolean {
  if (fromAddress(msg.from) !== rule.sender.trim().toLowerCase()) return false;
  const want = normalizeSpace(resolveSubjectPattern(rule.subjectPattern, rule.last4)).toLowerCase();
  return normalizeSpace(msg.subject).toLowerCase().includes(want);
}

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Decode the HTML entities a link inside an e-mail body may carry. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#x3d;|&#61;/gi, "=")
    .replace(/&#x26;|&#38;/gi, "&")
    .replace(/&quot;/gi, '"');
}

/**
 * Hosts a statement link may live on. A link anywhere else is ignored, so a
 * look-alike phishing URL in a spoofed e-mail can never be opened by the
 * browser worker. Extend per bank.
 */
export const STATEMENT_LINK_HOSTS: Record<string, RegExp> = {
  HDFC: /^smartstatements?\.hdfc(bank)?\.(bank\.in|com)$/i,
};

/** The first statement link in the message bodies whose host the bank owns. */
export function extractStatementUrl(bodies: string[], bankCode: string): string | null {
  const hostRule = STATEMENT_LINK_HOSTS[bankCode.toUpperCase()];
  if (!hostRule) return null;
  for (const body of bodies) {
    const text = decodeEntities(body);
    const re = /https:\/\/[^\s"'<>()]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const raw = m[0].replace(/[.,;]+$/, "");
      try {
        const u = new URL(raw);
        if (u.protocol === "https:" && hostRule.test(u.hostname)) return u.toString();
      } catch {
        /* not a URL */
      }
    }
  }
  return null;
}

/** base64url (Gmail's body encoding) → UTF-8 text. */
export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
};

/** Every text/html and text/plain body in a Gmail payload tree, decoded. */
export function collectBodies(part: GmailPart | undefined): string[] {
  if (!part) return [];
  const out: string[] = [];
  if ((part.mimeType === "text/html" || part.mimeType === "text/plain") && part.body?.data) {
    out.push(decodeBase64Url(part.body.data));
  }
  for (const p of part.parts ?? []) out.push(...collectBodies(p));
  return out;
}

/** The first PDF attachment in a Gmail payload tree, if the bank attached one. */
export function findPdfAttachment(part: GmailPart | undefined): { attachmentId: string; filename: string } | null {
  if (!part) return null;
  const isPdf = part.mimeType === "application/pdf" || /\.pdf$/i.test(part.filename ?? "");
  if (isPdf && part.body?.attachmentId) {
    return { attachmentId: part.body.attachmentId, filename: part.filename || "statement.pdf" };
  }
  for (const p of part.parts ?? []) {
    const hit = findPdfAttachment(p);
    if (hit) return hit;
  }
  return null;
}

/**
 * Gmail search query for a sender + subject, inside [afterIso, beforeIso).
 * The subject goes in as loose words, not a quoted phrase: Gmail tokenises
 * "***1234" unpredictably, so the search casts a slightly wide net and
 * matchesIntegration() makes the exact decision locally.
 */
export function gmailQuery(opts: { sender: string; subject: string; afterIso: string; beforeIso: string }): string {
  const day = (iso: string) => iso.replace(/-/g, "/");
  const words = opts.subject
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length >= 2)
    .slice(0, 12);
  const subject = words.length ? ` subject:(${words.join(" ")})` : "";
  return `from:${opts.sender}${subject} after:${day(opts.afterIso)} before:${day(opts.beforeIso)}`;
}
