/**
 * Reads for the SOP module: list filtering, dashboard counts, "My SOPs", and
 * the detail loader.
 *
 * Two-stage visibility, and the order matters:
 *
 *   1. `visibleSopWhere(access)` narrows in SQL, so a restricted SOP is not
 *      shipped out of the database only to be dropped in JavaScript.
 *   2. `canViewSop` (rbac.ts) is applied to whatever comes back, and is the
 *      AUTHORITATIVE answer.
 *
 * Stage 1 is an optimisation that must never be *narrower* than stage 2 (or
 * rows silently vanish) and must never be relied on as the only check. Every
 * detail loader here runs stage 2 explicitly.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { forbidden, notFound } from "@/lib/http-error";
import { canViewSop, type SopAccess } from "./rbac";
import { reviewBucket, isReviewDue, today } from "./review-dates";
import { acknowledgementState, summariseAcknowledgements } from "./acknowledge";
import type { AckState } from "./constants";

// ── Visibility ──────────────────────────────────────────────────────────────

/**
 * SQL-level narrowing that mirrors `canViewSop`, deliberately a little wider:
 * the confidentiality rules that depend on per-version arrays are settled in
 * `canViewSop` afterwards.
 */
export function visibleSopWhere(access: SopAccess): Prisma.SopWhereInput {
  if (access.isSopAdmin) return { deletedAt: null };

  const involved: Prisma.SopWhereInput[] = [
    { ownerEmployeeId: access.employeeId ?? "__none__" },
    { createdById: access.userId },
    { versions: { some: { reviewerId: access.userId } } },
    { versions: { some: { approverId: access.userId } } },
  ];
  if (access.employeeId) {
    involved.push({
      currentVersion: { applicableEmployeeIds: { has: access.employeeId } },
    });
  }

  const byLevel: Prisma.SopWhereInput[] = [{ confidentiality: "general" }];
  if (access.departmentIds.length > 0) {
    byLevel.push({
      confidentiality: "department",
      OR: [
        { departmentId: { in: access.departmentIds } },
        { currentVersion: { applicableDepartmentIds: { hasSome: access.departmentIds } } },
      ],
    });
  }
  if (access.isManagement) {
    byLevel.push({ confidentiality: "department" });
    byLevel.push({ confidentiality: "management" });
  }

  return {
    deletedAt: null,
    // Non-admins never see archived SOPs (§20).
    isArchived: false,
    OR: [...involved, ...byLevel],
  };
}

// ── Filters ─────────────────────────────────────────────────────────────────

export type SopFilters = {
  search?: string;
  departmentIds?: string[];
  ownerEmployeeIds?: string[];
  statuses?: string[];
  categoryIds?: string[];
  createdByIds?: string[];
  /** "overdue" | "due_today" | "due_soon" | "any" — the Review Due filter. */
  reviewDue?: string;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  /** Archive view. Defaults to live SOPs only. */
  archived?: boolean;
  requiresAcknowledgement?: boolean;
  publishedOnly?: boolean;
};

export type SopSort = "recent" | "title" | "number" | "most_viewed" | "review_due";

/** Turn the filter row into a Prisma where clause, ANDed with visibility. */
export function sopFilterWhere(access: SopAccess, f: SopFilters): Prisma.SopWhereInput {
  const and: Prisma.SopWhereInput[] = [visibleSopWhere(access)];

  // The archive is its own view, and only admins have it.
  if (f.archived) {
    if (!access.isSopAdmin) return { id: "__none__" };
    and.push({ isArchived: true, deletedAt: null });
  } else {
    and.push({ isArchived: false });
  }

  if (f.search?.trim()) {
    const q = f.search.trim();
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { sopNumber: { contains: q, mode: "insensitive" } },
        { processFunction: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (f.departmentIds?.length) and.push({ departmentId: { in: f.departmentIds } });
  if (f.ownerEmployeeIds?.length) and.push({ ownerEmployeeId: { in: f.ownerEmployeeIds } });
  if (f.statuses?.length) {
    // "Show me the SOPs under review" has to include a published SOP whose
    // REVISION is under review — the Sop row reads "published" in that case
    // (see denormalisedStatus in workflow.ts), so the in-flight draft is
    // matched too.
    and.push({
      OR: [
        { status: { in: f.statuses } },
        { draftVersion: { is: { status: { in: f.statuses } } } },
      ],
    });
  }
  if (f.categoryIds?.length) and.push({ categoryId: { in: f.categoryIds } });
  if (f.createdByIds?.length) and.push({ createdById: { in: f.createdByIds } });
  if (f.requiresAcknowledgement) and.push({ requiresAcknowledgement: true });
  if (f.publishedOnly) and.push({ currentVersionId: { not: null }, status: "published" });

  if (f.effectiveFrom) and.push({ effectiveDate: { gte: f.effectiveFrom } });
  if (f.effectiveTo) and.push({ effectiveDate: { lte: f.effectiveTo } });

  // Review-due is a date comparison, so it narrows in SQL; the exact bucket
  // (which depends on each SOP's own reminder window) is refined in memory.
  if (f.reviewDue) {
    const t = today();
    if (f.reviewDue === "overdue") and.push({ nextReviewDate: { lt: t } });
    else if (f.reviewDue === "due_today") and.push({ nextReviewDate: t });
    else if (f.reviewDue === "due_soon" || f.reviewDue === "any") {
      const horizon = new Date(t);
      horizon.setUTCDate(horizon.getUTCDate() + 30);
      and.push({ nextReviewDate: { not: null, lte: horizon } });
    }
  }

  return { AND: and };
}

function sopOrderBy(sort: SopSort): Prisma.SopOrderByWithRelationInput[] {
  switch (sort) {
    case "title":
      return [{ title: "asc" }];
    case "number":
      return [{ deptCode: "asc" }, { seq: "asc" }];
    case "most_viewed":
      return [{ viewCount: "desc" }, { updatedAt: "desc" }];
    case "review_due":
      // Nulls last: an SOP with no review scheduled is not the most urgent row.
      return [{ nextReviewDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }];
    case "recent":
    default:
      return [{ updatedAt: "desc" }];
  }
}

// ── List rows ───────────────────────────────────────────────────────────────

export const sopListSelect = {
  id: true,
  sopNumber: true,
  deptCode: true,
  title: true,
  status: true,
  confidentiality: true,
  processFunction: true,
  effectiveDate: true,
  nextReviewDate: true,
  requiresAcknowledgement: true,
  viewCount: true,
  isArchived: true,
  archivedAt: true,
  archiveReason: true,
  deletedAt: true,
  createdById: true,
  departmentId: true,
  ownerEmployeeId: true,
  createdAt: true,
  updatedAt: true,
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  ownerEmployee: { select: { id: true, name: true, empCode: true } },
  createdBy: { select: { id: true, username: true } },
  replacementSop: { select: { id: true, sopNumber: true, title: true } },
  currentVersion: {
    select: {
      id: true,
      versionLabel: true,
      publishedAt: true,
      reviewReminderDays: true,
      applicableDepartmentIds: true,
      applicableEmployeeIds: true,
    },
  },
  draftVersion: { select: { id: true, versionLabel: true, status: true } },
} satisfies Prisma.SopSelect;

export type SopListRecord = Prisma.SopGetPayload<{ select: typeof sopListSelect }>;

/** The plain object the table renders. Dates are ISO strings for the client. */
export type SopRow = {
  id: string;
  sopNumber: string;
  title: string;
  department: string | null;
  departmentId: string | null;
  category: string | null;
  categoryId: string | null;
  owner: string | null;
  ownerEmployeeId: string;
  version: string;
  status: string;
  confidentiality: string;
  effectiveDate: string | null;
  nextReviewDate: string | null;
  reviewBucket: string;
  lastUpdated: string;
  createdBy: string | null;
  requiresAcknowledgement: boolean;
  viewCount: number;
  isArchived: boolean;
  archiveReason: string | null;
  replacement: { id: string; sopNumber: string; title: string } | null;
  hasDraft: boolean;
  draftLabel: string | null;
};

export function toSopRow(s: SopListRecord, now: Date = new Date()): SopRow {
  const reminder = s.currentVersion?.reviewReminderDays ?? 15;
  return {
    id: s.id,
    sopNumber: s.sopNumber,
    title: s.title,
    department: s.department?.name ?? null,
    departmentId: s.departmentId,
    category: s.category?.name ?? null,
    categoryId: s.category?.id ?? null,
    owner: s.ownerEmployee?.name ?? null,
    ownerEmployeeId: s.ownerEmployeeId,
    // The version a reader would quote: the live one, else the draft in flight.
    version: s.currentVersion?.versionLabel ?? s.draftVersion?.versionLabel ?? "—",
    status: s.status,
    confidentiality: s.confidentiality,
    effectiveDate: iso(s.effectiveDate),
    nextReviewDate: iso(s.nextReviewDate),
    reviewBucket: reviewBucket(s.nextReviewDate, reminder, now),
    lastUpdated: s.updatedAt.toISOString(),
    createdBy: s.createdBy?.username ?? null,
    requiresAcknowledgement: s.requiresAcknowledgement,
    viewCount: s.viewCount,
    isArchived: s.isArchived,
    archiveReason: s.archiveReason,
    replacement: s.replacementSop
      ? { id: s.replacementSop.id, sopNumber: s.replacementSop.sopNumber, title: s.replacementSop.title }
      : null,
    hasDraft: !!s.draftVersion,
    draftLabel: s.draftVersion?.versionLabel ?? null,
  };
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * The filtered, visibility-checked list.
 *
 * `take` bounds the page. The refinement pass runs on the fetched page only, so
 * a page can come back slightly short when a row fails the in-memory
 * confidentiality check — correct, and preferable to leaking a row to make the
 * count tidy.
 */
export async function listSops(
  access: SopAccess,
  filters: SopFilters = {},
  opts: { sort?: SopSort; take?: number; skip?: number } = {},
): Promise<{ rows: SopRow[]; total: number }> {
  const where = sopFilterWhere(access, filters);
  const take = Math.min(Math.max(opts.take ?? 200, 1), 500);

  const [records, total] = await Promise.all([
    prisma.sop.findMany({
      where,
      select: sopListSelect,
      orderBy: sopOrderBy(opts.sort ?? "recent"),
      take,
      skip: opts.skip ?? 0,
    }),
    prisma.sop.count({ where }),
  ]);

  const now = new Date();
  const visible = records.filter((s) =>
    canViewSop(access, s, s.currentVersion ?? null),
  );

  // Refine the review-due filter against each SOP's own reminder window, which
  // SQL cannot express (it is a per-row column, not a constant).
  const refined =
    filters.reviewDue && filters.reviewDue !== "any"
      ? visible.filter(
          (s) => reviewBucket(s.nextReviewDate, s.currentVersion?.reviewReminderDays ?? 15, now) === filters.reviewDue,
        )
      : visible;

  return { rows: refined.map((s) => toSopRow(s, now)), total };
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export type SopDashboardCounts = {
  total: number;
  published: number;
  draft: number;
  underReview: number;
  approvalPending: number;
  reviewDue: number;
  overdueReviews: number;
  requiringAcknowledgement: number;
};

/**
 * The eight dashboard cards, scoped to what the viewer can see.
 *
 * Counted with `groupBy` + two date counts rather than eight round trips: the
 * dashboard is the module's landing page and pays this cost on every visit.
 */
/**
 * The eight dashboard cards, scoped to what the viewer can see.
 *
 * The split matters: the SOP-level numbers (total, published) count `Sop`
 * rows, while the workflow numbers (draft, under review, approval pending)
 * count IN-FLIGHT `SopVersion` rows. A published SOP with a revision under
 * review is one published SOP *and* one version under review, and a reviewer
 * looking for their queue needs the second number to include it.
 *
 * Consequence, deliberately: the cards do not sum to the total. They are
 * counting two different things, and forcing them to add up would mean hiding
 * revisions from the people reviewing them.
 */
export async function dashboardCounts(access: SopAccess): Promise<SopDashboardCounts> {
  const base = sopFilterWhere(access, {});
  const t = today();
  const soon = new Date(t);
  soon.setUTCDate(soon.getUTCDate() + 30);

  // In-flight versions belonging to an SOP the viewer can see.
  const versionBase: Prisma.SopVersionWhereInput = { sop: { is: base } };

  const [total, published, byVersionStatus, overdue, dueSoon, needsAck] = await Promise.all([
    prisma.sop.count({ where: base }),
    prisma.sop.count({ where: { AND: [base, { status: "published" }] } }),
    prisma.sopVersion.groupBy({
      by: ["status"],
      where: {
        ...versionBase,
        status: {
          in: ["draft", "changes_requested", "revision_required", "review_requested", "approval_pending", "approved"],
        },
      },
      _count: { _all: true },
    }),
    prisma.sop.count({ where: { AND: [base, { nextReviewDate: { lt: t } }] } }),
    prisma.sop.count({ where: { AND: [base, { nextReviewDate: { gte: t, lte: soon } }] } }),
    prisma.sop.count({
      where: { AND: [base, { requiresAcknowledgement: true, status: "published" }] },
    }),
  ]);

  const v = (status: string) => byVersionStatus.find((r) => r.status === status)?._count._all ?? 0;

  return {
    total,
    published,
    // Everything sitting with its author: a fresh draft, one sent back for
    // changes, and one flagged as needing revision.
    draft: v("draft") + v("changes_requested") + v("revision_required"),
    underReview: v("review_requested"),
    // Approved-but-unpublished belongs here too: it is still waiting on
    // someone, and that someone is whoever can publish it.
    approvalPending: v("approval_pending") + v("approved"),
    reviewDue: overdue + dueSoon,
    overdueReviews: overdue,
    requiringAcknowledgement: needsAck,
  };
}

// ── My SOPs ─────────────────────────────────────────────────────────────────

export const MY_SOP_TABS = [
  "owned",
  "created",
  "to_review",
  "to_approve",
  "to_acknowledge",
  "review_due",
] as const;
export type MySopTab = (typeof MY_SOP_TABS)[number];

export const MY_SOP_TAB_LABELS: Record<MySopTab, string> = {
  owned: "Owned by Me",
  created: "Created by Me",
  to_review: "Assigned for Review",
  to_approve: "Awaiting My Approval",
  to_acknowledge: "Acknowledgement Required",
  review_due: "Review Due",
};

/** Counts for every My-SOPs tab, so the tab bar can badge them. */
export async function mySopCounts(access: SopAccess): Promise<Record<MySopTab, number>> {
  const [owned, created, toReview, toApprove, toAck, reviewDue] = await Promise.all([
    access.employeeId
      ? prisma.sop.count({
          where: { ownerEmployeeId: access.employeeId, isArchived: false, deletedAt: null },
        })
      : Promise.resolve(0),
    prisma.sop.count({ where: { createdById: access.userId, isArchived: false, deletedAt: null } }),
    prisma.sopVersion.count({
      where: { reviewerId: access.userId, status: "review_requested", sop: { deletedAt: null, isArchived: false } },
    }),
    prisma.sopVersion.count({
      where: { approverId: access.userId, status: "approval_pending", sop: { deletedAt: null, isArchived: false } },
    }),
    access.employeeId
      ? prisma.sopAcknowledgement.count({
          where: { employeeId: access.employeeId, acknowledgedAt: null, sop: { deletedAt: null } },
        })
      : Promise.resolve(0),
    access.employeeId
      ? prisma.sop.count({
          where: {
            OR: [
              { ownerEmployeeId: access.employeeId },
              { currentVersion: { reviewOwnerEmployeeId: access.employeeId } },
            ],
            isArchived: false,
            deletedAt: null,
            nextReviewDate: { not: null, lte: addDays(today(), 30) },
          },
        })
      : Promise.resolve(0),
  ]);

  return {
    owned,
    created,
    to_review: toReview,
    to_approve: toApprove,
    to_acknowledge: toAck,
    review_due: reviewDue,
  };
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/** The rows behind one My-SOPs tab. */
export async function mySops(access: SopAccess, tab: MySopTab): Promise<SopRow[]> {
  const live = { isArchived: false, deletedAt: null } as const;
  let where: Prisma.SopWhereInput;

  switch (tab) {
    case "owned":
      where = { ...live, ownerEmployeeId: access.employeeId ?? "__none__" };
      break;
    case "created":
      where = { ...live, createdById: access.userId };
      break;
    case "to_review":
      where = { ...live, versions: { some: { reviewerId: access.userId, status: "review_requested" } } };
      break;
    case "to_approve":
      where = { ...live, versions: { some: { approverId: access.userId, status: "approval_pending" } } };
      break;
    case "to_acknowledge":
      where = {
        ...live,
        acknowledgements: { some: { employeeId: access.employeeId ?? "__none__", acknowledgedAt: null } },
      };
      break;
    case "review_due":
      where = {
        ...live,
        nextReviewDate: { not: null, lte: addDays(today(), 30) },
        OR: [
          { ownerEmployeeId: access.employeeId ?? "__none__" },
          { currentVersion: { reviewOwnerEmployeeId: access.employeeId ?? "__none__" } },
          ...(access.isSopAdmin ? [{}] : []),
        ],
      };
      break;
  }

  const records = await prisma.sop.findMany({
    where,
    select: sopListSelect,
    orderBy: tab === "review_due" ? [{ nextReviewDate: "asc" }] : [{ updatedAt: "desc" }],
    take: 200,
  });
  const now = new Date();
  // These tabs are all "SOPs you are personally involved in", so the viewer is
  // entitled to every row by construction — but the check still runs, because
  // "by construction" is exactly the assumption that rots.
  return records
    .filter((s) => canViewSop(access, s, s.currentVersion ?? null))
    .map((s) => toSopRow(s, now));
}

// ── Detail ──────────────────────────────────────────────────────────────────

export const sopDetailInclude = {
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  ownerEmployee: { select: { id: true, name: true, empCode: true, designation: true } },
  createdBy: { select: { id: true, username: true } },
  archivedBy: { select: { id: true, username: true } },
  replacementSop: { select: { id: true, sopNumber: true, title: true } },
} satisfies Prisma.SopInclude;

export const versionDetailInclude = {
  department: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  ownerEmployee: { select: { id: true, name: true, empCode: true } },
  reviewOwnerEmployee: { select: { id: true, name: true } },
  reviewer: { select: { id: true, username: true } },
  approver: { select: { id: true, username: true } },
  createdBy: { select: { id: true, username: true } },
  reviewedBy: { select: { id: true, username: true } },
  approvedBy: { select: { id: true, username: true } },
  publishedBy: { select: { id: true, username: true } },
  steps: {
    orderBy: { seq: "asc" },
    include: {
      checklists: { orderBy: { seq: "asc" } },
      responsibleRole: { select: { id: true, name: true } },
      responsibleDepartment: { select: { id: true, name: true } },
      assignedEmployee: { select: { id: true, name: true } },
    },
  },
  qualityCriteria: { orderBy: { seq: "asc" } },
  exceptions: {
    orderBy: { seq: "asc" },
    include: {
      escalateToRole: { select: { id: true, name: true } },
      escalateToEmployee: { select: { id: true, name: true } },
    },
  },
  kpis: {
    orderBy: { seq: "asc" },
    include: {
      kpiOwnerEmployee: { select: { id: true, name: true } },
      reviews: { orderBy: { periodEnd: "desc" }, take: 6, include: { reviewedBy: { select: { username: true } } } },
    },
  },
  attachments: { orderBy: { createdAt: "asc" }, include: { uploadedBy: { select: { username: true } } } },
  actions: { orderBy: { actedAt: "asc" }, include: { actor: { select: { username: true } } } },
} satisfies Prisma.SopVersionInclude;

/**
 * Load an SOP plus one of its versions, authorising both.
 *
 * `versionId` defaults to the live published version, falling back to the
 * in-flight draft for an SOP that has never been published — which is what
 * someone opening an unpublished SOP means by "the SOP".
 */
export async function loadSopDetail(
  sopId: string,
  access: SopAccess,
  versionId?: string | null,
) {
  const sop = await prisma.sop.findUnique({ where: { id: sopId }, include: sopDetailInclude });
  if (!sop || sop.deletedAt) throw notFound("SOP not found.");

  const targetVersionId = versionId ?? sop.currentVersionId ?? sop.draftVersionId;
  const version = targetVersionId
    ? await prisma.sopVersion.findFirst({
        where: { id: targetVersionId, sopId },
        include: versionDetailInclude,
      })
    : null;

  if (!canViewSop(access, sop, version)) throw forbidden();

  return { sop, version };
}

/** Every version of an SOP, newest first — the Version History panel (§15). */
export async function versionHistory(sopId: string) {
  return prisma.sopVersion.findMany({
    where: { sopId },
    orderBy: [{ major: "desc" }, { minor: "desc" }],
    select: {
      id: true,
      versionLabel: true,
      status: true,
      isLocked: true,
      changeSummary: true,
      effectiveDate: true,
      publishedAt: true,
      archivedAt: true,
      previousVersionId: true,
      createdAt: true,
      createdBy: { select: { username: true } },
      reviewedBy: { select: { username: true } },
      approvedBy: { select: { username: true } },
      publishedBy: { select: { username: true } },
    },
  });
}

/** The audit trail for an SOP (§16). Admin/owner surfaces only. */
export async function auditTrail(sopId: string, take = 200) {
  return prisma.sopAuditLog.findMany({
    where: { sopId },
    orderBy: { occurredAt: "desc" },
    take,
    include: { user: { select: { username: true } } },
  });
}

// ── Acknowledgements ────────────────────────────────────────────────────────

export type AckRowView = {
  id: string;
  sopId: string;
  sopNumber: string;
  sopTitle: string;
  versionId: string;
  versionLabel: string;
  employeeId: string;
  employeeName: string;
  empCode: string;
  department: string | null;
  deadline: string | null;
  viewedAt: string | null;
  acknowledgedAt: string | null;
  state: AckState;
};

/** The acknowledgement register for one published version. */
export async function acknowledgementRegister(versionId: string) {
  const rows = await prisma.sopAcknowledgement.findMany({
    where: { versionId },
    orderBy: [{ acknowledgedAt: "asc" }, { employee: { name: "asc" } }],
    include: {
      employee: {
        select: {
          id: true,
          name: true,
          empCode: true,
          departments: {
            where: { isPrimary: true },
            select: { department: { select: { name: true } } },
            take: 1,
          },
        },
      },
      sop: { select: { id: true, sopNumber: true, title: true } },
      version: { select: { id: true, versionLabel: true } },
    },
  });

  const now = new Date();
  const view: AckRowView[] = rows.map((r) => ({
    id: r.id,
    sopId: r.sopId,
    sopNumber: r.sop.sopNumber,
    sopTitle: r.sop.title,
    versionId: r.versionId,
    versionLabel: r.version.versionLabel,
    employeeId: r.employeeId,
    employeeName: r.employee.name,
    empCode: r.employee.empCode,
    department: r.employee.departments[0]?.department.name ?? null,
    deadline: iso(r.deadline),
    viewedAt: r.viewedAt?.toISOString() ?? null,
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    state: acknowledgementState(r, now),
  }));

  return { rows: view, summary: summariseAcknowledgements(rows, now) };
}

/** The signed-in employee's own outstanding acknowledgements. */
export async function myAcknowledgements(access: SopAccess) {
  if (!access.employeeId) return [];
  const rows = await prisma.sopAcknowledgement.findMany({
    where: { employeeId: access.employeeId, sop: { deletedAt: null } },
    orderBy: [{ acknowledgedAt: "asc" }, { deadline: "asc" }],
    include: {
      sop: {
        select: {
          id: true,
          sopNumber: true,
          title: true,
          ownerEmployee: { select: { name: true } },
          department: { select: { name: true } },
        },
      },
      version: { select: { id: true, versionLabel: true, effectiveDate: true } },
    },
    take: 200,
  });
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    sopId: r.sopId,
    sopNumber: r.sop.sopNumber,
    title: r.sop.title,
    department: r.sop.department?.name ?? null,
    processOwner: r.sop.ownerEmployee?.name ?? null,
    versionId: r.versionId,
    versionLabel: r.version.versionLabel,
    effectiveDate: iso(r.version.effectiveDate),
    deadline: iso(r.deadline),
    viewedAt: r.viewedAt?.toISOString() ?? null,
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    state: acknowledgementState(r, now),
  }));
}

// ── Pickers ─────────────────────────────────────────────────────────────────

/** Everything the editor's dropdowns need, in one round trip. */
export async function editorOptions() {
  const [departments, categories, employees, hrRoles, users] = await Promise.all([
    prisma.hrDepartment.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.sopCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.employee.findMany({
      where: { active: true },
      select: { id: true, name: true, empCode: true, designation: true, userId: true },
      orderBy: { name: "asc" },
    }),
    prisma.hrRole.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Reviewers and approvers must be able to sign in, so this list is Users,
    // labelled with their employee name where one is linked.
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true, employeeProfile: { select: { name: true } } },
      orderBy: { username: "asc" },
    }),
  ]);

  return {
    departments,
    categories,
    employees,
    hrRoles,
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      label: u.employeeProfile?.name ? `${u.employeeProfile.name} (${u.username})` : u.username,
    })),
  };
}

/** Distinct SOP owners and creators, for the filter row's pickers. */
export async function filterOptions(access: SopAccess) {
  const where = visibleSopWhere(access);
  const [owners, creators, departments, categories] = await Promise.all([
    prisma.sop.findMany({
      where,
      select: { ownerEmployee: { select: { id: true, name: true } } },
      distinct: ["ownerEmployeeId"],
      orderBy: { ownerEmployeeId: "asc" },
    }),
    prisma.sop.findMany({
      where,
      select: { createdBy: { select: { id: true, username: true } } },
      distinct: ["createdById"],
      orderBy: { createdById: "asc" },
    }),
    prisma.hrDepartment.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.sopCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return {
    owners: owners.map((o) => o.ownerEmployee).filter((o): o is { id: string; name: string } => !!o),
    creators: creators
      .map((c) => c.createdBy)
      .filter((c): c is { id: string; username: string } => !!c),
    departments,
    categories,
  };
}

/** SOPs whose review is due — the dashboard panel and the review-due tab. */
export async function reviewDueSops(access: SopAccess, withinDays = 30): Promise<SopRow[]> {
  const t = today();
  const horizon = addDays(t, withinDays);
  const records = await prisma.sop.findMany({
    where: {
      AND: [visibleSopWhere(access), { isArchived: false, nextReviewDate: { not: null, lte: horizon } }],
    },
    select: sopListSelect,
    orderBy: { nextReviewDate: "asc" },
    take: 100,
  });
  const now = new Date();
  return records
    .filter((s) => canViewSop(access, s, s.currentVersion ?? null))
    .filter((s) => isReviewDue(reviewBucket(s.nextReviewDate, s.currentVersion?.reviewReminderDays ?? 15, now)))
    .map((s) => toSopRow(s, now));
}
