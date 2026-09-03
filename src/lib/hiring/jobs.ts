import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, conflict } from "@/lib/http-error";
import {
  DEFAULT_STAGES,
  DEFAULT_RUBRIC,
  DEFAULT_SCREENING_QUESTIONS,
  JOB_AGING_DAYS,
} from "./constants";
import { slugify, uniqueSlug, validateJobForPublish, daysOpen, isAging, compBandLabel } from "./core";

/**
 * Requisition queries and state transitions — the one place that decides what a
 * job list contains and when a job may go live, so the Jobs rail, the careers
 * page and the API can never disagree.
 */

export const JOB_TABS = ["all", "live", "drafts", "paused", "closed", "aging"] as const;
export type JobTab = (typeof JOB_TABS)[number];

export const JOB_TAB_LABELS: Record<JobTab, string> = {
  all: "All",
  live: "Live",
  drafts: "Drafts",
  paused: "Paused",
  closed: "Closed",
  aging: "Aging",
};

/** The cutoff instant for "published more than 21 days ago". */
export function agingCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - JOB_AGING_DAYS * 86_400_000);
}

export function buildJobWhere(filters: {
  tab?: string | null;
  department?: string | null;
  ownerId?: string | null;
  locationId?: string | null;
  q?: string | null;
}): Prisma.HiringJobWhereInput {
  // Soft-deleted reqs are gone from every list; only an owner's audited hard
  // delete removes the row itself.
  const where: Prisma.HiringJobWhereInput = { deletedAt: null };

  switch (filters.tab) {
    case "live":
      where.status = "live";
      break;
    case "drafts":
      // A req awaiting approval is still the author's draft as far as the
      // board is concerned — it is not live and it needs their attention.
      where.status = { in: ["draft", "pending_approval"] };
      break;
    case "paused":
      where.status = "paused";
      break;
    case "closed":
      where.status = "closed";
      break;
    case "aging":
      where.status = "live";
      where.publishedAt = { lt: agingCutoff() };
      break;
    default:
      break;
  }

  if (filters.department) where.department = filters.department;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.locationId) where.locationId = filters.locationId;
  if (filters.q?.trim()) {
    where.OR = [
      { title: { contains: filters.q.trim(), mode: "insensitive" } },
      { department: { contains: filters.q.trim(), mode: "insensitive" } },
    ];
  }
  return where;
}

export const jobListInclude = {
  location: { select: { id: true, name: true } },
  owner: { select: { id: true, username: true } },
  hiringManager: { select: { id: true, username: true } },
  _count: { select: { applications: true } },
} satisfies Prisma.HiringJobInclude;

type JobRow = Prisma.HiringJobGetPayload<{ include: typeof jobListInclude }>;

export type JobRowDTO = ReturnType<typeof serializeJobRow>;

export function serializeJobRow(j: JobRow) {
  const compMin = j.compMinLakh == null ? null : Number(j.compMinLakh);
  const compMax = j.compMaxLakh == null ? null : Number(j.compMaxLakh);
  return {
    id: j.id,
    title: j.title,
    slug: j.slug,
    department: j.department,
    locationName: j.location?.name ?? null,
    locationId: j.locationId,
    workType: j.workType,
    employmentType: j.employmentType,
    seniority: j.seniority,
    compMinLakh: compMin,
    compMaxLakh: compMax,
    compLabel: compBandLabel(compMin, compMax),
    compVisible: j.compVisible,
    openings: j.openings,
    status: j.status,
    ownerId: j.ownerId,
    ownerName: j.owner?.username ?? null,
    hiringManagerName: j.hiringManager?.username ?? null,
    approvalRequired: j.approvalRequired,
    approvedAt: j.approvedAt?.toISOString() ?? null,
    publishedAt: j.publishedAt?.toISOString() ?? null,
    closedAt: j.closedAt?.toISOString() ?? null,
    closeReason: j.closeReason,
    mustHaves: j.mustHaves,
    niceToHaves: j.niceToHaves,
    applicantCount: j._count.applications,
    daysOpen: daysOpen(j),
    isAging: isAging(j),
    createdAt: j.createdAt.toISOString(),
  };
}

export type JobKpis = {
  openReqs: number;
  applicants90d: number;
  inInterview: number;
  offersOut: number;
  aging: number;
};

/**
 * The five header numbers on the Jobs rail.
 *
 * "In interview" is deliberately defined as an ACTIVE application that has at
 * least one interview booked — not "sitting in a stage named Interview".
 * Stages are renameable and reorderable per job, so a name match would quietly
 * under-count the moment someone renamed a column.
 */
export async function computeJobKpis(now: Date = new Date()): Promise<JobKpis> {
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
  const [openReqs, applicants90d, inInterview, offersOut, aging] = await Promise.all([
    prisma.hiringJob.count({ where: { status: "live", deletedAt: null } }),
    prisma.hiringApplication.count({
      where: { deletedAt: null, appliedAt: { gte: ninetyDaysAgo } },
    }),
    prisma.hiringApplication.count({
      where: { deletedAt: null, status: "active", interviews: { some: {} } },
    }),
    prisma.hiringOffer.count({
      where: { deletedAt: null, status: { in: ["sent", "viewed"] } },
    }),
    prisma.hiringJob.count({
      where: { status: "live", deletedAt: null, publishedAt: { lt: agingCutoff(now) } },
    }),
  ]);
  return { openReqs, applicants90d, inInterview, offersOut, aging };
}

/** Allocate a careers-page slug that is unique across every req, live or not. */
export async function allocateSlug(title: string): Promise<string> {
  const root = slugify(title) || "role";
  const taken = await prisma.hiringJob.findMany({
    where: { slug: { startsWith: root } },
    select: { slug: true },
  });
  return uniqueSlug(root, taken.map((t) => t.slug));
}

/**
 * Create a requisition. Always lands as a DRAFT — publishing is a separate,
 * validated transition, so a half-written req can never appear on the careers
 * page by accident.
 */
export async function createJob(input: {
  title: string;
  department: string;
  jobRoleId?: string | null;
  locationId?: string | null;
  workType?: string;
  employmentType?: string;
  seniority?: string;
  compMinLakh?: number | null;
  compMaxLakh?: number | null;
  compVisible?: boolean;
  descriptionMd?: string | null;
  mustHaves?: string[];
  niceToHaves?: string[];
  openings?: number;
  ownerId?: string | null;
  hiringManagerId?: string | null;
  approvalRequired?: boolean;
  resumeMode?: string;
  askScreeningQs?: boolean;
  questions?: { prompt: string; helperText?: string | null; answerType: string; required: boolean; options?: unknown }[];
  rubrics?: { criterion: string; description?: string | null; weight: number }[];
  createdById: string;
}) {
  if (input.compMinLakh != null && input.compMaxLakh != null && input.compMinLakh > input.compMaxLakh) {
    throw badRequest("The minimum of the comp band is above its maximum.", "bad_comp_band");
  }

  const slug = await allocateSlug(input.title);
  const rubrics = input.rubrics?.length ? input.rubrics : DEFAULT_RUBRIC;
  const questions =
    input.askScreeningQs === false
      ? []
      : input.questions?.length
        ? input.questions
        : DEFAULT_SCREENING_QUESTIONS;

  return prisma.hiringJob.create({
    data: {
      title: input.title.trim(),
      slug,
      department: input.department.trim(),
      jobRoleId: input.jobRoleId ?? null,
      locationId: input.locationId ?? null,
      workType: input.workType ?? "onsite",
      employmentType: input.employmentType ?? "full_time",
      seniority: input.seniority ?? "mid",
      compMinLakh: input.compMinLakh ?? null,
      compMaxLakh: input.compMaxLakh ?? null,
      compVisible: input.compVisible ?? false,
      descriptionMd: input.descriptionMd ?? null,
      mustHaves: input.mustHaves ?? [],
      niceToHaves: input.niceToHaves ?? [],
      openings: input.openings ?? 1,
      status: "draft",
      ownerId: input.ownerId ?? input.createdById,
      hiringManagerId: input.hiringManagerId ?? null,
      approvalRequired: input.approvalRequired ?? false,
      resumeMode: input.resumeMode ?? "required",
      askScreeningQs: input.askScreeningQs ?? true,
      createdById: input.createdById,
      // Every job is seeded with the standard pipeline; stages are reorderable
      // and renameable afterwards without breaking analytics, which group by
      // kind + position.
      stages: {
        create: DEFAULT_STAGES.map((s, i) => ({
          name: s.name,
          position: i,
          kind: s.kind,
          slaDays: s.slaDays,
        })),
      },
      rubrics: {
        create: rubrics.map((r, i) => ({
          criterion: r.criterion,
          description: r.description ?? null,
          weight: r.weight,
          position: i,
        })),
      },
      questions: {
        create: questions.map((q, i) => ({
          prompt: q.prompt,
          helperText: q.helperText ?? null,
          answerType: q.answerType,
          required: q.required,
          options: (q as { options?: unknown }).options as never,
          position: i,
        })),
      },
    },
    include: jobListInclude,
  });
}

export type PublishOutcome =
  | { published: true; status: "live"; slug: string }
  | { published: false; status: "pending_approval"; slug: string }
  | { published: false; status: "draft"; blockers: string[] };

/**
 * Publish, or explain why not. A req missing a description, must-haves or a
 * rubric totalling 100% stays a draft and says so — it is never half-published.
 * When the req is routed for approval, publishing parks it at
 * `pending_approval` instead of going live.
 */
export async function publishJob(jobId: string): Promise<PublishOutcome> {
  const job = await prisma.hiringJob.findFirst({
    where: { id: jobId, deletedAt: null },
    include: { rubrics: true },
  });
  if (!job) throw badRequest("That requisition no longer exists.", "unknown_job");
  if (job.status === "closed") {
    throw conflict("This requisition is closed. Reopen it before publishing.", "job_closed");
  }

  const readiness = validateJobForPublish({
    title: job.title,
    descriptionMd: job.descriptionMd,
    mustHaves: job.mustHaves,
    rubrics: job.rubrics,
  });
  if (!readiness.ready) {
    await prisma.hiringJob.update({ where: { id: jobId }, data: { status: "draft" } });
    return { published: false, status: "draft", blockers: readiness.blockers };
  }

  if (job.approvalRequired && !job.approvedAt) {
    await prisma.hiringJob.update({
      where: { id: jobId },
      data: { status: "pending_approval" },
    });
    return { published: false, status: "pending_approval", slug: job.slug };
  }

  await prisma.hiringJob.update({
    where: { id: jobId },
    data: {
      status: "live",
      // First publish stamps the clock; re-publishing a paused req does not
      // reset it, so "days open" stays honest across a pause.
      publishedAt: job.publishedAt ?? new Date(),
      closedAt: null,
      closeReason: null,
    },
  });
  return { published: true, status: "live", slug: job.slug };
}

/** Closing always records a reason — an unexplained closed req helps nobody. */
export async function closeJob(jobId: string, reason: string) {
  if (!reason.trim()) throw badRequest("Give a reason for closing this requisition.", "reason_required");
  return prisma.hiringJob.update({
    where: { id: jobId },
    data: { status: "closed", closedAt: new Date(), closeReason: reason.trim() },
  });
}

/** CSV for the Jobs rail export. */
export function jobsToCsv(rows: JobRowDTO[]): string {
  const head = [
    "Title", "Department", "Location", "Work type", "Seniority", "Openings",
    "Status", "Owner", "Applicants", "Days open", "Aging", "Comp band", "Published",
  ];
  const body = rows.map((r) => [
    r.title, r.department, r.locationName ?? "", r.workType, r.seniority, String(r.openings),
    r.status, r.ownerName ?? "", String(r.applicantCount), r.daysOpen == null ? "" : String(r.daysOpen),
    r.isAging ? "yes" : "no", r.compLabel ?? "", r.publishedAt ?? "",
  ]);
  return [head, ...body].map((cells) => cells.map(csvCell).join(",")).join("\r\n");
}

function csvCell(v: string): string {
  // Guard against a leading =/+/-/@ being read as a formula by Excel.
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
