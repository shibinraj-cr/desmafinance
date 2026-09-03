import { prisma } from "@/lib/prisma";
import { compBandLabel } from "./core";
import { WORK_TYPE_LABELS, EMPLOYMENT_TYPE_LABELS, SENIORITY_LABELS } from "./constants";
import type { WorkType, EmploymentType, Seniority } from "./constants";

/**
 * The public careers surface. Everything here is readable WITHOUT a session,
 * so it exposes only what a job ad may contain — never an owner, a candidate,
 * an internal note or a comp band the recruiter chose to keep private.
 */

export type PublicJob = {
  slug: string;
  title: string;
  department: string;
  locationName: string | null;
  workType: string;
  workTypeLabel: string;
  employmentType: string;
  employmentTypeLabel: string;
  seniorityLabel: string;
  compLabel: string | null;
  openings: number;
  descriptionMd: string | null;
  mustHaves: string[];
  niceToHaves: string[];
  publishedAt: string | null;
};

/** Only LIVE, non-deleted reqs are public. */
export async function listPublicJobs(): Promise<PublicJob[]> {
  const jobs = await prisma.hiringJob.findMany({
    where: { status: "live", deletedAt: null },
    include: { location: { select: { name: true } } },
    orderBy: [{ department: "asc" }, { publishedAt: "desc" }],
  });
  return jobs.map(toPublicJob);
}

export async function getPublicJob(slug: string): Promise<PublicJob | null> {
  const job = await prisma.hiringJob.findFirst({
    where: { slug, status: "live", deletedAt: null },
    include: { location: { select: { name: true } } },
  });
  return job ? toPublicJob(job) : null;
}

/** The apply form's shape for one job, safe to render publicly. */
export async function getApplyForm(slug: string) {
  const job = await prisma.hiringJob.findFirst({
    where: { slug, status: "live", deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      resumeMode: true,
      askScreeningQs: true,
      questions: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          prompt: true,
          helperText: true,
          answerType: true,
          options: true,
          required: true,
        },
      },
    },
  });
  if (!job) return null;
  return {
    jobId: job.id,
    title: job.title,
    slug: job.slug,
    resumeMode: job.resumeMode,
    questions: job.askScreeningQs ? job.questions : [],
  };
}

type JobRow = {
  slug: string;
  title: string;
  department: string;
  workType: string;
  employmentType: string;
  seniority: string;
  compMinLakh: unknown;
  compMaxLakh: unknown;
  compVisible: boolean;
  openings: number;
  descriptionMd: string | null;
  mustHaves: string[];
  niceToHaves: string[];
  publishedAt: Date | null;
  location: { name: string } | null;
};

function toPublicJob(j: JobRow): PublicJob {
  return {
    slug: j.slug,
    title: j.title,
    department: j.department,
    locationName: j.location?.name ?? null,
    workType: j.workType,
    workTypeLabel: WORK_TYPE_LABELS[j.workType as WorkType] ?? j.workType,
    employmentType: j.employmentType,
    employmentTypeLabel: EMPLOYMENT_TYPE_LABELS[j.employmentType as EmploymentType] ?? j.employmentType,
    seniorityLabel: SENIORITY_LABELS[j.seniority as Seniority] ?? j.seniority,
    // The band is shown only when the recruiter opted in.
    compLabel: j.compVisible
      ? compBandLabel(
          j.compMinLakh == null ? null : Number(j.compMinLakh),
          j.compMaxLakh == null ? null : Number(j.compMaxLakh),
        )
      : null,
    openings: j.openings,
    descriptionMd: j.descriptionMd,
    mustHaves: j.mustHaves,
    niceToHaves: j.niceToHaves,
    publishedAt: j.publishedAt?.toISOString() ?? null,
  };
}

/**
 * schema.org JobPosting for the role page. Search engines read this; getting
 * the shape wrong means the listing simply does not appear, so it is built from
 * the same PublicJob the page renders rather than a parallel hand-written blob.
 */
export function jobPostingJsonLd(job: PublicJob, siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.descriptionMd ?? job.title,
    datePosted: job.publishedAt,
    employmentType: job.employmentType.toUpperCase(),
    hiringOrganization: {
      "@type": "Organization",
      name: "DESMA International Pvt Ltd",
      sameAs: siteUrl,
    },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: job.locationName ?? "Kochi",
        addressRegion: "Kerala",
        addressCountry: "IN",
      },
    },
    jobLocationType: job.workType === "remote" ? "TELECOMMUTE" : undefined,
    totalJobOpenings: job.openings,
    directApply: true,
    url: `${siteUrl}/careers/desma/${job.slug}`,
  };
}
