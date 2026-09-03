import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, conflict, notFound } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { normalizeEmail, normalizeCandidatePhone, missingMustHaves } from "./core";
import type { CandidateSource } from "./constants";

/**
 * Application intake — the one path a candidate enters the pipeline by,
 * whether from the public careers page, a referral, a partner submission, a
 * CSV import or someone typing them in.
 *
 * Two invariants it exists to hold:
 *   1. The PERSON is deduped (email, then phone) so three applications from
 *      one person are one candidate record with three applications.
 *   2. Every entry writes a `created` event, because the funnel is computed
 *      from events and an application with no event is invisible to analytics.
 */

export type ApplyInput = {
  jobId: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  resumeUrl?: string | null;
  portfolioUrl?: string | null;
  linkedinUrl?: string | null;
  locationText?: string | null;
  currentTitle?: string | null;
  currentEmployer?: string | null;
  totalExperienceYears?: number | null;
  noticePeriodDays?: number | null;
  currentCtcLakh?: number | null;
  expectedCtcLakh?: number | null;
  /** Keyed by screening-question id. */
  answers?: Record<string, unknown>;
  source: CandidateSource;
  sourceDetail?: string | null;
  sourceAttributionId?: string | null;
  ownerId?: string | null;
  createdById?: string | null;
  consent?: boolean;
  /** Retention window; the careers form states it to the applicant. */
  retentionMonths?: number;
};

export type ApplyResult = {
  candidateId: string;
  applicationId: string;
  /** True when this person already existed and we attached to their record. */
  matchedExistingCandidate: boolean;
  /** Must-haves the application shows no evidence for — a flag for a human. */
  flaggedMustHaves: string[];
};

/**
 * Find the person, or make them. Email wins over phone as the identity: it is
 * the field candidates type most carefully, and a shared family phone is more
 * common here than a shared inbox.
 */
async function findOrCreateCandidate(
  tx: Prisma.TransactionClient,
  input: ApplyInput,
  email: string | null,
  phone: string | null,
): Promise<{ id: string; matched: boolean }> {
  const existing =
    (email ? await tx.hiringCandidate.findUnique({ where: { email } }) : null) ??
    (phone ? await tx.hiringCandidate.findUnique({ where: { phone } }) : null);

  if (existing) {
    // Fill in blanks only. A human-edited field is never overwritten by a
    // later application's form data — see HiringCandidate.humanEditedFields.
    const edited = new Set(existing.humanEditedFields);
    const fill = <K extends keyof Prisma.HiringCandidateUpdateInput>(
      key: K & string,
      value: unknown,
      current: unknown,
    ) => (value != null && current == null && !edited.has(key) ? { [key]: value } : {});

    await tx.hiringCandidate.update({
      where: { id: existing.id },
      data: {
        ...fill("phone", phone, existing.phone),
        ...fill("email", email, existing.email),
        ...fill("resumeUrl", input.resumeUrl, existing.resumeUrl),
        ...fill("portfolioUrl", input.portfolioUrl, existing.portfolioUrl),
        ...fill("linkedinUrl", input.linkedinUrl, existing.linkedinUrl),
        ...fill("locationText", input.locationText, existing.locationText),
        ...fill("currentTitle", input.currentTitle, existing.currentTitle),
        ...fill("currentEmployer", input.currentEmployer, existing.currentEmployer),
        ...fill("noticePeriodDays", input.noticePeriodDays, existing.noticePeriodDays),
        ...fill("expectedCtcLakh", input.expectedCtcLakh, existing.expectedCtcLakh),
        ...(input.consent ? { consentAt: existing.consentAt ?? new Date() } : {}),
        isActive: true,
      },
    });
    return { id: existing.id, matched: true };
  }

  const retentionMonths = input.retentionMonths ?? 24;
  const created = await tx.hiringCandidate.create({
    data: {
      fullName: input.fullName.trim(),
      email,
      phone,
      resumeUrl: input.resumeUrl ?? null,
      portfolioUrl: input.portfolioUrl ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      locationText: input.locationText ?? null,
      currentTitle: input.currentTitle ?? null,
      currentEmployer: input.currentEmployer ?? null,
      totalExperienceYears: input.totalExperienceYears ?? null,
      noticePeriodDays: input.noticePeriodDays ?? null,
      currentCtcLakh: input.currentCtcLakh ?? null,
      expectedCtcLakh: input.expectedCtcLakh ?? null,
      source: input.source,
      sourceDetail: input.sourceDetail ?? null,
      sourceAttributionId: input.sourceAttributionId ?? null,
      ownerId: input.ownerId ?? null,
      createdById: input.createdById ?? null,
      consentAt: input.consent ? new Date() : null,
      dataRetentionUntil: new Date(Date.now() + retentionMonths * 30 * 86_400_000),
    },
  });
  return { id: created.id, matched: false };
}

/**
 * Put a person into a job's pipeline at its first stage.
 *
 * Runs in one transaction so a half-created application — a candidate with no
 * application, or an application with no `created` event — cannot exist.
 */
export async function submitApplication(input: ApplyInput): Promise<ApplyResult> {
  const email = normalizeEmail(input.email);
  const phone = normalizeCandidatePhone(input.phone);
  if (!email && !phone) {
    throw badRequest("An email address or a phone number is needed.", "no_contact");
  }
  if (!input.fullName.trim()) throw badRequest("A name is needed.", "no_name");

  const job = await prisma.hiringJob.findFirst({
    where: { id: input.jobId, deletedAt: null },
    include: { stages: { orderBy: { position: "asc" }, take: 1 } },
  });
  if (!job) throw notFound("That role is no longer open.");

  const firstStage = job.stages[0] ?? null;

  // What the screening reads: the candidate's own words, nothing else.
  const answerText = Object.values(input.answers ?? {})
    .map((v) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")))
    .join("\n");
  const haystack = [
    answerText,
    input.currentTitle ?? "",
    input.currentEmployer ?? "",
    input.locationText ?? "",
  ].join("\n");
  const flagged = missingMustHaves(job.mustHaves, haystack);

  const result = await prisma.$transaction(async (tx) => {
    const candidate = await findOrCreateCandidate(tx, input, email, phone);

    const already = await tx.hiringApplication.findUnique({
      where: { candidateId_jobId: { candidateId: candidate.id, jobId: input.jobId } },
    });
    if (already) {
      if (already.deletedAt) {
        // A previously removed application is restored rather than duplicated,
        // so the timeline stays one continuous story.
        await tx.hiringApplication.update({
          where: { id: already.id },
          data: { deletedAt: null, status: "active", stageEnteredAt: new Date() },
        });
        await tx.hiringApplicationEvent.create({
          data: { applicationId: already.id, type: "reopened", payload: { via: input.source } },
        });
        return { candidate, applicationId: already.id };
      }
      throw conflict("You have already applied to this role.", "already_applied");
    }

    const app = await tx.hiringApplication.create({
      data: {
        candidateId: candidate.id,
        jobId: input.jobId,
        stageId: firstStage?.id ?? null,
        status: "active",
        answers: (input.answers ?? {}) as never,
        // A missing must-have is a FLAG a human confirms — never a rejection,
        // and never a reason the application does not appear.
        screenedOutReason: flagged.length
          ? `No evidence for: ${flagged.join(", ")}`
          : null,
        needsAttention: flagged.length > 0,
        appliedAt: new Date(),
        stageEnteredAt: new Date(),
      },
    });

    await tx.hiringApplicationEvent.create({
      data: {
        applicationId: app.id,
        type: "created",
        toStage: firstStage?.name ?? null,
        actorId: input.createdById ?? null,
        payload: { source: input.source, flaggedMustHaves: flagged },
      },
    });

    return { candidate, applicationId: app.id };
  });

  logger.info("hiring_application_created", {
    jobId: input.jobId,
    source: input.source,
    matched: result.candidate.matched,
    flagged: flagged.length,
  });

  return {
    candidateId: result.candidate.id,
    applicationId: result.applicationId,
    matchedExistingCandidate: result.candidate.matched,
    flaggedMustHaves: flagged,
  };
}
