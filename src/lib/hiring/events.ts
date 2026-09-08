import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Domain events this module publishes for other modules to consume.
 *
 * §1 puts People Ops explicitly out of scope and asks for the handoff hook
 * only. So this is the whole hook: `hire.completed` becomes a durable row that
 * a People Ops module can read whenever it is built. Nothing in the hiring
 * module writes to employee tables, and nothing here calls into another module
 * synchronously.
 */

export const HIRE_COMPLETED = "hire.completed";

export type HireCompletedPayload = {
  candidateId: string;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  jobId: string;
  jobTitle: string;
  department: string | null;
  applicationId: string;
  offerId: string | null;
  startDate: string | null;
  terms: {
    baseLakh: number;
    variableLakh: number | null;
    joiningBonusLakh: number | null;
    totalCtcLakh: number;
    probationMonths: number | null;
    noticePeriodDays: number | null;
  } | null;
  hiredAt: string;
};

/**
 * Emit `hire.completed`. Idempotent by (type, application) — marking someone
 * hired twice, or re-running a backfill, publishes one event.
 *
 * Never throws: a hire is a real thing that happened, and failing to write its
 * event must not roll back the hire.
 */
export async function emitHireCompleted(payload: HireCompletedPayload): Promise<void> {
  try {
    await prisma.hiringDomainEvent.upsert({
      where: {
        type_subjectType_subjectId: {
          type: HIRE_COMPLETED,
          subjectType: "HiringApplication",
          subjectId: payload.applicationId,
        },
      },
      create: {
        type: HIRE_COMPLETED,
        subjectType: "HiringApplication",
        subjectId: payload.applicationId,
        payload: payload as never,
        version: 1,
      },
      // A re-emit refreshes the payload (terms can be corrected before anyone
      // has consumed it) but never resets `consumedAt`.
      update: { payload: payload as never },
    });
    logger.info("hiring_event_emitted", { type: HIRE_COMPLETED, applicationId: payload.applicationId });
  } catch (e) {
    logger.error("hiring_event_failed", {
      type: HIRE_COMPLETED,
      applicationId: payload.applicationId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Build the payload from an application that has just been marked hired. */
export async function buildHireCompletedPayload(
  applicationId: string,
): Promise<HireCompletedPayload | null> {
  const app = await prisma.hiringApplication.findUnique({
    where: { id: applicationId },
    include: {
      candidate: { select: { id: true, fullName: true, email: true, phone: true } },
      job: { select: { id: true, title: true, department: true } },
      offers: {
        where: { status: "accepted" },
        orderBy: { respondedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!app) return null;

  const offer = app.offers[0] ?? null;
  const base = offer ? Number(offer.baseLakh) : null;
  const variable = offer?.variableLakh == null ? null : Number(offer.variableLakh);
  const bonus = offer?.joiningBonusLakh == null ? null : Number(offer.joiningBonusLakh);

  return {
    candidateId: app.candidate.id,
    candidateName: app.candidate.fullName,
    candidateEmail: app.candidate.email,
    candidatePhone: app.candidate.phone,
    jobId: app.job.id,
    jobTitle: app.job.title,
    department: app.job.department,
    applicationId: app.id,
    offerId: offer?.id ?? null,
    startDate: offer?.startDate?.toISOString() ?? null,
    terms:
      offer && base != null
        ? {
            baseLakh: base,
            variableLakh: variable,
            joiningBonusLakh: bonus,
            totalCtcLakh: Math.round((base + (variable ?? 0) + (bonus ?? 0)) * 100) / 100,
            probationMonths: offer.probationMonths,
            noticePeriodDays: offer.noticePeriodDays,
          }
        : null,
    hiredAt: (app.hiredAt ?? new Date()).toISOString(),
  };
}
