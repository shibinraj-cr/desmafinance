import { createHash } from "node:crypto";
import { normalizeEmail, normalizeCandidatePhone } from "../core";

/**
 * The dedupe ladder for ingested résumés.
 *
 * Exact match on email-or-phone — what the apply path uses — is too weak for a
 * folder of CVs collected over years. The same person turns up with a work and
 * a personal address, with a résumé from 2024 and another from 2026, and with
 * no email in the PDF at all. And two different people genuinely share a name.
 *
 * So this is a ladder, cheapest and most certain first, and only the last rung
 * involves a judgement call — which is why that rung PROPOSES rather than
 * merges. An automatic merge on weak evidence silently destroys one person's
 * history inside another's record, and nobody finds out.
 */

export type DedupeKind = "hash" | "email" | "phone" | "proposed" | "none";

export type ExistingCandidate = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  resumeHash: string | null;
  currentEmployer: string | null;
};

export type IncomingCandidate = {
  fileHash: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  currentEmployer: string | null;
};

export type DedupeResult = {
  kind: DedupeKind;
  candidateId: string | null;
  /** Why, in words a recruiter can act on. */
  reason: string | null;
  /** True only for `proposed` — the UI must ask before merging. */
  needsConfirmation: boolean;
};

export function hashFile(bytes: Buffer | ArrayBuffer): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Normalise a name for comparison.
 *
 * Tokens are SORTED, because Indian names are written in either order —
 * "Anu Menon" and "Menon Anu" are one person, and a naive string compare says
 * they are two. Honorifics and initials are dropped: an initial carries almost
 * no distinguishing information and its presence varies between documents.
 */
export function normalizeName(raw: string): string {
  const titles = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sri", "smt"]);
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !titles.has(t))
    .sort()
    .join(" ");
}

/** The last 7 digits, which survive +91 / 0 / spacing differences. */
export function phoneTail(raw: string | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-7) : null;
}

function normalizeEmployer(raw: string | null): string | null {
  const v = (raw ?? "")
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|technologies|solutions)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
  return v.length >= 3 ? v : null;
}

/**
 * Walk the ladder. `existing` is the set of candidates worth comparing against
 * — the caller narrows it by hash, email, phone and name so this stays cheap.
 */
export function classify(
  incoming: IncomingCandidate,
  existing: ExistingCandidate[],
): DedupeResult {
  const none: DedupeResult = { kind: "none", candidateId: null, reason: null, needsConfirmation: false };
  if (!existing.length) return none;

  // 1. The same file. Certain, and free — checked before any parsing spend.
  const byHash = existing.find((c) => c.resumeHash && c.resumeHash === incoming.fileHash);
  if (byHash) {
    return {
      kind: "hash",
      candidateId: byHash.id,
      reason: `The identical file is already on ${byHash.fullName}'s record.`,
      needsConfirmation: false,
    };
  }

  // 2. Exact contact details — the same rule the apply path uses.
  const email = normalizeEmail(incoming.email);
  if (email) {
    const hit = existing.find((c) => c.email === email);
    if (hit) {
      return {
        kind: "email",
        candidateId: hit.id,
        reason: `${email} already belongs to ${hit.fullName}.`,
        needsConfirmation: false,
      };
    }
  }

  const phone = normalizeCandidatePhone(incoming.phone);
  if (phone) {
    const hit = existing.find((c) => c.phone === phone);
    if (hit) {
      return {
        kind: "phone",
        candidateId: hit.id,
        reason: `${phone} already belongs to ${hit.fullName}.`,
        needsConfirmation: false,
      };
    }
  }

  // 3. A name plus ONE corroborating signal. Never a name alone: in a Kerala
  // résumé pile exact name collisions are common, and merging two people is far
  // worse than carrying a duplicate somebody can merge later.
  const name = normalizeName(incoming.fullName);
  if (!name) return none;

  const tail = phoneTail(incoming.phone);
  const employer = normalizeEmployer(incoming.currentEmployer);

  for (const c of existing) {
    if (normalizeName(c.fullName) !== name) continue;

    if (tail && phoneTail(c.phone) === tail) {
      return {
        kind: "proposed",
        candidateId: c.id,
        reason: `Same name as ${c.fullName}, and the phone numbers end in the same 7 digits.`,
        needsConfirmation: true,
      };
    }
    if (employer && normalizeEmployer(c.currentEmployer) === employer) {
      return {
        kind: "proposed",
        candidateId: c.id,
        reason: `Same name as ${c.fullName}, and both list the same current employer.`,
        needsConfirmation: true,
      };
    }
  }

  return none;
}

/** True when the result may be applied without asking a human. */
export function isCertain(result: DedupeResult): boolean {
  return result.kind === "hash" || result.kind === "email" || result.kind === "phone";
}
