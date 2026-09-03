import type { Prisma } from "@prisma/client";
import { CANDIDATE_SOURCE_LABELS, type CandidateSource } from "./constants";
import { daysInStage, isSlaBreached } from "./pipeline";

/**
 * The Candidates rail and the Pipeline board read the same rows through here,
 * so a card and a table row can never disagree about a score, a stage or a
 * flag.
 *
 * The unit is the APPLICATION, not the person: someone who applied to three
 * roles is three rows, because a stage and a score belong to one application.
 * The drawer is where the person is shown whole.
 */

export const CANDIDATE_STATUS_FILTERS = [
  "active",
  "all",
  "rejected",
  "on_hold",
  "needs_attention",
] as const;
export type CandidateStatusFilter = (typeof CANDIDATE_STATUS_FILTERS)[number];

export const CANDIDATE_STATUS_LABELS: Record<CandidateStatusFilter, string> = {
  active: "Active only",
  all: "All statuses",
  rejected: "Rejected",
  on_hold: "On hold",
  needs_attention: "⚑ Needs attention",
};

export const CANDIDATE_SORTS = [
  "score_desc",
  "score_asc",
  "name_asc",
  "recent",
  "longest_since_contact",
  "next_follow_up",
] as const;
export type CandidateSort = (typeof CANDIDATE_SORTS)[number];

export const CANDIDATE_SORT_LABELS: Record<CandidateSort, string> = {
  score_desc: "Score, high to low",
  score_asc: "Score, low to high",
  name_asc: "Name A–Z",
  recent: "Most recent",
  longest_since_contact: "Longest since contact",
  next_follow_up: "Next follow-up",
};

export function buildCandidateWhere(filters: {
  status?: string | null;
  jobId?: string | null;
  stageId?: string | null;
  ownerId?: string | null;
  minScore?: number | null;
  source?: string | null;
  q?: string | null;
}): Prisma.HiringApplicationWhereInput {
  const where: Prisma.HiringApplicationWhereInput = { deletedAt: null };

  switch (filters.status) {
    case "all":
      break;
    case "rejected":
      where.status = "rejected";
      break;
    case "on_hold":
      where.status = "on_hold";
      break;
    case "needs_attention":
      where.needsAttention = true;
      break;
    case "active":
    default:
      where.status = "active";
      break;
  }

  if (filters.jobId) where.jobId = filters.jobId;
  if (filters.stageId) where.stageId = filters.stageId;
  if (filters.minScore != null) where.aiScore = { gte: filters.minScore };

  const candidateWhere: Prisma.HiringCandidateWhereInput = { deletedAt: null };
  if (filters.ownerId) candidateWhere.ownerId = filters.ownerId;
  if (filters.source) candidateWhere.source = filters.source;
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    candidateWhere.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q.toLowerCase() } },
      { phone: { contains: q } },
      { currentEmployer: { contains: q, mode: "insensitive" } },
    ];
  }
  where.candidate = candidateWhere;

  return where;
}

/**
 * Prisma ordering for the sorts it can express. `longest_since_contact` is
 * deliberately absent: "never contacted" must sort FIRST, and a nulls-first
 * ordering on a nullable column is not something Prisma expresses portably —
 * so that one is sorted in `sortRows` after serialization, where the rule is
 * visible instead of implied.
 */
export function candidateOrderBy(sort: string | null | undefined): Prisma.HiringApplicationOrderByWithRelationInput[] {
  switch (sort) {
    case "score_asc":
      return [{ aiScore: "asc" }, { appliedAt: "desc" }];
    case "name_asc":
      return [{ candidate: { fullName: "asc" } }];
    case "recent":
      return [{ appliedAt: "desc" }];
    case "next_follow_up":
      return [{ nextFollowUpAt: "asc" }, { appliedAt: "desc" }];
    case "longest_since_contact":
      return [{ appliedAt: "asc" }];
    case "score_desc":
    default:
      return [{ aiScore: "desc" }, { appliedAt: "desc" }];
  }
}

export const applicationListInclude = {
  candidate: {
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      currentTitle: true,
      currentEmployer: true,
      locationText: true,
      source: true,
      tags: true,
      resumeUrl: true,
      owner: { select: { id: true, username: true } },
    },
  },
  job: { select: { id: true, title: true, department: true } },
  stage: { select: { id: true, name: true, kind: true, position: true, slaDays: true } },
  _count: { select: { interviews: true, notes: true } },
} satisfies Prisma.HiringApplicationInclude;

type AppRow = Prisma.HiringApplicationGetPayload<{ include: typeof applicationListInclude }>;

export type ApplicationRowDTO = ReturnType<typeof serializeApplicationRow>;

export function serializeApplicationRow(a: AppRow, now: Date = new Date()) {
  return {
    id: a.id,
    candidateId: a.candidate.id,
    fullName: a.candidate.fullName,
    email: a.candidate.email,
    phone: a.candidate.phone,
    currentTitle: a.candidate.currentTitle,
    currentEmployer: a.candidate.currentEmployer,
    locationText: a.candidate.locationText,
    resumeUrl: a.candidate.resumeUrl,
    tags: a.candidate.tags,
    source: a.candidate.source,
    sourceLabel: CANDIDATE_SOURCE_LABELS[a.candidate.source as CandidateSource] ?? a.candidate.source,
    ownerId: a.candidate.owner?.id ?? null,
    ownerName: a.candidate.owner?.username ?? null,
    jobId: a.job.id,
    jobTitle: a.job.title,
    department: a.job.department,
    stageId: a.stage?.id ?? null,
    stageName: a.stage?.name ?? null,
    stageKind: a.stage?.kind ?? null,
    stagePosition: a.stage?.position ?? null,
    status: a.status,
    aiScore: a.aiScore,
    aiScoredAt: a.aiScoredAt?.toISOString() ?? null,
    needsAttention: a.needsAttention,
    screenedOutReason: a.screenedOutReason,
    rejectionReason: a.rejectionReason,
    appliedAt: a.appliedAt.toISOString(),
    stageEnteredAt: a.stageEnteredAt.toISOString(),
    lastContactedAt: a.lastContactedAt?.toISOString() ?? null,
    nextFollowUpAt: a.nextFollowUpAt?.toISOString() ?? null,
    daysInStage: daysInStage(a, now),
    slaBreached: isSlaBreached(a, a.stage, now),
    /** Days since the last outbound touch; null when nobody has ever reached out. */
    daysSinceContact: a.lastContactedAt
      ? Math.floor((now.getTime() - a.lastContactedAt.getTime()) / 86_400_000)
      : null,
    interviewCount: a._count.interviews,
    noteCount: a._count.notes,
  };
}

/**
 * The sort Prisma cannot express. "Nobody has EVER contacted this person"
 * is the most urgent case, so it sorts above everyone who has been contacted,
 * oldest-contact first behind it.
 */
export function sortRows(rows: ApplicationRowDTO[], sort: string | null | undefined): ApplicationRowDTO[] {
  if (sort !== "longest_since_contact") return rows;
  return [...rows].sort((a, b) => {
    if (a.daysSinceContact == null && b.daysSinceContact == null) {
      return a.appliedAt.localeCompare(b.appliedAt);
    }
    if (a.daysSinceContact == null) return -1;
    if (b.daysSinceContact == null) return 1;
    return b.daysSinceContact - a.daysSinceContact;
  });
}

/** CSV for the Candidates rail export. */
export function candidatesToCsv(rows: ApplicationRowDTO[]): string {
  const head = [
    "Name", "Email", "Phone", "Role", "Department", "Stage", "Status", "AI score",
    "Source", "Owner", "Applied", "Last contacted", "Days in stage", "Needs attention",
  ];
  const body = rows.map((r) => [
    r.fullName, r.email ?? "", r.phone ?? "", r.jobTitle, r.department, r.stageName ?? "",
    r.status, r.aiScore == null ? "" : String(r.aiScore), r.sourceLabel, r.ownerName ?? "",
    r.appliedAt.slice(0, 10), r.lastContactedAt?.slice(0, 10) ?? "", String(r.daysInStage),
    r.needsAttention ? "yes" : "no",
  ]);
  return [head, ...body].map((cells) => cells.map(csvCell).join(",")).join("\r\n");
}

function csvCell(v: string): string {
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
