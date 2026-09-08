import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The sourcing-partner boundary (§6, §10).
 *
 * The spec assumed Postgres RLS. This install has none, so the boundary is a
 * QUERY GUARD instead: every partner-facing read goes through a `where` built
 * here, and none of them accept a caller-supplied filter. That is the whole
 * design — a partner-facing route cannot express "all applications", because
 * the only function that builds its `where` clause always ANDs in the partner
 * id and the granted-jobs list.
 *
 * `tests/hiring-partner-isolation.test.ts` asserts the shape of every clause
 * this file produces, and fails by default: a new partner-facing query that
 * forgets the scope has to be added to that test to pass review, and a scope
 * that stops constraining fails it immediately.
 *
 * What a partner may see:
 *   - the jobs explicitly granted in HiringPartnerJobAccess, and nothing else,
 *   - their OWN submissions, and no other partner's,
 *   - their own fee ledger.
 * What they may never see: the wider pipeline, other partners' candidates,
 * internal notes, scores, or any other partner's fees.
 */

// ── Sessions ───────────────────────────────────────────────────────────────

export const PARTNER_COOKIE = "hiring_partner_session";
const MAGIC_LINK_TTL_MIN = 30;
const SESSION_TTL_DAYS = 7;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function mintToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

/** Create a single-use magic link for a partner. Returns the raw token once. */
export async function createMagicLink(partnerId: string, ip: string | null): Promise<string> {
  const { raw, hash } = mintToken();
  await prisma.hiringPartnerSession.create({
    data: {
      partnerId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MIN * 60_000),
      createdIp: ip,
    },
  });
  return raw;
}

/**
 * Exchange a magic-link token for a portal session. Single-use: the row is
 * marked consumed, and its window extended to the session lifetime. A second
 * click on the same link gets nothing.
 */
export async function consumeMagicLink(rawToken: string): Promise<{ partnerId: string } | null> {
  const row = await prisma.hiringPartnerSession.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { partner: { select: { id: true, status: true } } },
  });
  if (!row) return null;
  if (row.consumedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  // A paused or merely invited agency cannot walk in on an old link.
  if (row.partner.status !== "active" && row.partner.status !== "trial") return null;

  await prisma.hiringPartnerSession.update({
    where: { id: row.id },
    data: {
      consumedAt: new Date(),
      sessionExpiresAt: new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000),
    },
  });
  return { partnerId: row.partnerId };
}

/** Resolve a portal session cookie to a partner, or null. */
export async function resolvePartnerSession(rawToken: string | undefined): Promise<string | null> {
  if (!rawToken) return null;
  const row = await prisma.hiringPartnerSession.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { partner: { select: { status: true } } },
  });
  if (!row?.consumedAt || !row.sessionExpiresAt) return null;
  if (row.sessionExpiresAt.getTime() < Date.now()) return null;
  if (row.partner.status !== "active" && row.partner.status !== "trial") return null;
  return row.partnerId;
}

/** Constant-time compare, for anywhere a token is checked against a known value. */
export function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ── The scope itself ───────────────────────────────────────────────────────

/** The job ids a partner has been granted. The ONLY source of that list. */
export async function grantedJobIds(partnerId: string): Promise<string[]> {
  const rows = await prisma.hiringPartnerJobAccess.findMany({
    where: { partnerId },
    select: { jobId: true },
  });
  return rows.map((r) => r.jobId);
}

/**
 * Jobs a partner may see. Note there is no parameter for "which jobs" — the
 * caller cannot widen this.
 */
export function partnerJobWhere(grantedIds: string[]): Prisma.HiringJobWhereInput {
  return {
    // An empty grant list must match NOTHING. `{ in: [] }` does exactly that,
    // where omitting the clause would have matched everything — which is the
    // failure mode this whole file exists to make impossible.
    id: { in: grantedIds },
    deletedAt: null,
    status: { in: ["live", "paused"] },
  };
}

/** Submissions a partner may see: theirs, on jobs they still hold. */
export function partnerSubmissionWhere(
  partnerId: string,
  grantedIds: string[],
): Prisma.HiringPartnerSubmissionWhereInput {
  return { partnerId, jobId: { in: grantedIds } };
}

/**
 * Applications a partner may see. Scoped BOTH by the granted job and by the
 * submission being theirs — either alone would leak: job-only would show them
 * another agency's candidates on a shared req, and submission-only would keep
 * showing candidates on a req whose access was revoked.
 */
export function partnerApplicationWhere(
  partnerId: string,
  grantedIds: string[],
): Prisma.HiringApplicationWhereInput {
  return {
    deletedAt: null,
    jobId: { in: grantedIds },
    partnerSub: { partnerId },
  };
}

/**
 * The candidate fields a partner may read. Deliberately a select, not an
 * omit: a field added to HiringCandidate later is invisible to partners until
 * somebody deliberately adds it here.
 */
export const PARTNER_CANDIDATE_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  currentTitle: true,
  currentEmployer: true,
  locationText: true,
  resumeUrl: true,
} satisfies Prisma.HiringCandidateSelect;

/**
 * The application fields a partner may read. No score, no breakdown, no
 * screening flag, no internal reason — a partner is told the STAGE and the
 * status, which is what they need to chase their own placement.
 */
export const PARTNER_APPLICATION_SELECT = {
  id: true,
  status: true,
  appliedAt: true,
  stage: { select: { name: true } },
  job: { select: { id: true, title: true } },
  candidate: { select: PARTNER_CANDIDATE_SELECT },
} satisfies Prisma.HiringApplicationSelect;

/** Fields a partner must never receive, asserted in the isolation test. */
export const PARTNER_FORBIDDEN_FIELDS = [
  "aiScore",
  "aiScoreBreakdown",
  "screenedOutReason",
  "rejectionReason",
  "notes",
  "events",
  "needsAttention",
  "nextFollowUpAt",
  "lastContactedAt",
];
