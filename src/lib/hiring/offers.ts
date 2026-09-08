import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, notFound, conflict } from "@/lib/http-error";
import { totalCtcLakh } from "./core";

/**
 * Offers: the money, the approval gate, and the state machine.
 *
 * The one rule worth stating: an offer above the requisition's published comp
 * band cannot be sent without an approval. That is checked HERE, on the way in,
 * rather than in the UI — the UI shows it, but the server is what enforces it.
 */

export type OfferTerms = {
  baseLakh: number;
  variableLakh: number | null;
  joiningBonusLakh: number | null;
};

/** Total CTC in lakh/year — what the letter states and the band is checked against. */
export function offerTotalLakh(terms: OfferTerms): number {
  return totalCtcLakh(terms);
}

export type BandCheck = {
  withinBand: boolean;
  /** Null when the req has no band to check against. */
  bandMaxLakh: number | null;
  overBy: number;
};

/**
 * Whether an offer sits inside the requisition's band. Compared on BASE, not on
 * total CTC: the band on a req is a base-salary band, and counting a joining
 * bonus against it would send routine offers for approval for no reason.
 */
export function checkBand(
  baseLakh: number,
  job: { compMinLakh: number | null; compMaxLakh: number | null },
): BandCheck {
  if (job.compMaxLakh == null) return { withinBand: true, bandMaxLakh: null, overBy: 0 };
  const over = baseLakh - job.compMaxLakh;
  return {
    withinBand: over <= 0,
    bandMaxLakh: job.compMaxLakh,
    overBy: over > 0 ? Math.round(over * 100) / 100 : 0,
  };
}

export const offerInclude = {
  application: {
    select: {
      id: true,
      status: true,
      candidate: { select: { id: true, fullName: true, email: true, phone: true } },
      job: {
        select: {
          id: true,
          title: true,
          department: true,
          compMinLakh: true,
          compMaxLakh: true,
          stages: { orderBy: { position: "asc" }, select: { id: true, name: true, kind: true } },
        },
      },
    },
  },
  location: { select: { id: true, name: true } },
  envelopes: {
    orderBy: { createdAt: "desc" as const },
    select: { id: true, signedAt: true, pdfUrl: true, tokenExpiresAt: true, usedAt: true },
  },
} satisfies Prisma.HiringOfferInclude;

type OfferRow = Prisma.HiringOfferGetPayload<{ include: typeof offerInclude }>;

export type OfferDTO = ReturnType<typeof serializeOffer>;

export function serializeOffer(o: OfferRow) {
  const terms: OfferTerms = {
    baseLakh: Number(o.baseLakh),
    variableLakh: o.variableLakh == null ? null : Number(o.variableLakh),
    joiningBonusLakh: o.joiningBonusLakh == null ? null : Number(o.joiningBonusLakh),
  };
  const band = checkBand(terms.baseLakh, {
    compMinLakh: o.application.job.compMinLakh == null ? null : Number(o.application.job.compMinLakh),
    compMaxLakh: o.application.job.compMaxLakh == null ? null : Number(o.application.job.compMaxLakh),
  });
  const envelope = o.envelopes[0] ?? null;

  return {
    id: o.id,
    applicationId: o.applicationId,
    candidateId: o.application.candidate.id,
    candidateName: o.application.candidate.fullName,
    candidateEmail: o.application.candidate.email,
    jobId: o.application.job.id,
    jobTitle: o.jobTitle,
    department: o.department,
    locationName: o.location?.name ?? null,
    startDate: o.startDate?.toISOString() ?? null,
    ...terms,
    totalCtcLakh: offerTotalLakh(terms),
    withinBand: band.withinBand,
    bandMaxLakh: band.bandMaxLakh,
    overBy: band.overBy,
    probationMonths: o.probationMonths,
    noticePeriodDays: o.noticePeriodDays,
    otherTermsMd: o.otherTermsMd,
    status: o.status,
    approvedAt: o.approvedAt?.toISOString() ?? null,
    sentAt: o.sentAt?.toISOString() ?? null,
    viewedAt: o.viewedAt?.toISOString() ?? null,
    respondedAt: o.respondedAt?.toISOString() ?? null,
    expiresAt: o.expiresAt?.toISOString() ?? null,
    signedAt: envelope?.signedAt?.toISOString() ?? null,
    pdfUrl: envelope?.pdfUrl ?? null,
    hasEnvelope: !!envelope,
    createdAt: o.createdAt.toISOString(),
  };
}

/**
 * Which statuses count as "out" for the Jobs KPI. `sent` and `viewed` only:
 * a draft is not out, and an accepted one is no longer out.
 */
export const OFFERS_OUT_STATUSES = ["sent", "viewed"];

/** Statuses an offer can still be edited from. */
const EDITABLE = new Set(["draft", "pending_approval"]);

export async function createOffer(input: {
  applicationId: string;
  jobTitle?: string;
  department?: string | null;
  locationId?: string | null;
  startDate?: string | null;
  baseLakh: number;
  variableLakh?: number | null;
  joiningBonusLakh?: number | null;
  otherTermsMd?: string | null;
  probationMonths?: number | null;
  noticePeriodDays?: number | null;
  expiresAt?: string | null;
  createdById: string;
}) {
  const app = await prisma.hiringApplication.findFirst({
    where: { id: input.applicationId, deletedAt: null },
    include: { job: true, candidate: { select: { fullName: true } } },
  });
  if (!app) throw notFound("That application no longer exists.");
  if (app.status === "rejected" || app.status === "withdrawn") {
    throw badRequest(
      "That candidate is not in the pipeline any more. Move them back before making an offer.",
      "not_active",
    );
  }

  const open = await prisma.hiringOffer.findFirst({
    where: {
      applicationId: input.applicationId,
      deletedAt: null,
      status: { in: ["draft", "pending_approval", "sent", "viewed", "accepted"] },
    },
  });
  if (open) {
    throw conflict(
      "There is already an open offer on this application. Withdraw it before making another.",
      "offer_exists",
    );
  }

  const band = checkBand(input.baseLakh, {
    compMinLakh: app.job.compMinLakh == null ? null : Number(app.job.compMinLakh),
    compMaxLakh: app.job.compMaxLakh == null ? null : Number(app.job.compMaxLakh),
  });

  return prisma.hiringOffer.create({
    data: {
      applicationId: input.applicationId,
      jobTitle: input.jobTitle?.trim() || app.job.title,
      department: input.department ?? app.job.department,
      locationId: input.locationId ?? app.job.locationId,
      startDate: input.startDate ? new Date(input.startDate) : null,
      baseLakh: input.baseLakh,
      variableLakh: input.variableLakh ?? null,
      joiningBonusLakh: input.joiningBonusLakh ?? null,
      otherTermsMd: input.otherTermsMd ?? null,
      probationMonths: input.probationMonths ?? null,
      noticePeriodDays: input.noticePeriodDays ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      // Over the band means it starts life needing an approval, not a draft
      // somebody might send without noticing.
      status: band.withinBand ? "draft" : "pending_approval",
      createdById: input.createdById,
    },
    include: offerInclude,
  });
}

export async function updateOffer(
  offerId: string,
  patch: Partial<{
    jobTitle: string;
    department: string | null;
    locationId: string | null;
    startDate: string | null;
    baseLakh: number;
    variableLakh: number | null;
    joiningBonusLakh: number | null;
    otherTermsMd: string | null;
    probationMonths: number | null;
    noticePeriodDays: number | null;
    expiresAt: string | null;
  }>,
) {
  const offer = await prisma.hiringOffer.findFirst({
    where: { id: offerId, deletedAt: null },
    include: { application: { include: { job: true } } },
  });
  if (!offer) throw notFound("That offer no longer exists.");
  if (!EDITABLE.has(offer.status)) {
    throw conflict(
      `An offer that has been ${offer.status} cannot be edited. Withdraw it and write a new one.`,
      "offer_locked",
    );
  }

  const base = patch.baseLakh ?? Number(offer.baseLakh);
  const band = checkBand(base, {
    compMinLakh: offer.application.job.compMinLakh == null ? null : Number(offer.application.job.compMinLakh),
    compMaxLakh: offer.application.job.compMaxLakh == null ? null : Number(offer.application.job.compMaxLakh),
  });

  return prisma.hiringOffer.update({
    where: { id: offerId },
    data: {
      jobTitle: patch.jobTitle,
      department: patch.department,
      locationId: patch.locationId,
      startDate: patch.startDate === undefined ? undefined : patch.startDate ? new Date(patch.startDate) : null,
      baseLakh: patch.baseLakh,
      variableLakh: patch.variableLakh,
      joiningBonusLakh: patch.joiningBonusLakh,
      otherTermsMd: patch.otherTermsMd,
      probationMonths: patch.probationMonths,
      noticePeriodDays: patch.noticePeriodDays,
      expiresAt: patch.expiresAt === undefined ? undefined : patch.expiresAt ? new Date(patch.expiresAt) : null,
      // Raising the base past the band re-arms the approval gate; an approval
      // given for a smaller number is not an approval for a larger one.
      ...(band.withinBand
        ? {}
        : { status: "pending_approval", approvedAt: null, approvedById: null }),
    },
    include: offerInclude,
  });
}

/** Whether this offer may be sent right now, and why not. */
export function sendBlockers(offer: {
  status: string;
  baseLakh: number;
  approvedAt: Date | null;
  expiresAt: Date | null;
  job: { compMinLakh: number | null; compMaxLakh: number | null };
  candidateEmail: string | null;
}): string[] {
  const blockers: string[] = [];
  if (offer.status === "sent" || offer.status === "viewed") blockers.push("This offer has already been sent.");
  if (offer.status === "accepted") blockers.push("This offer has already been accepted.");
  if (offer.status === "withdrawn") blockers.push("This offer was withdrawn.");
  if (!offer.candidateEmail) {
    blockers.push("The candidate has no email address, and the signing link is sent by email.");
  }
  const band = checkBand(offer.baseLakh, offer.job);
  if (!band.withinBand && !offer.approvedAt) {
    blockers.push(
      `The base is ₹${band.overBy} lakh over the requisition's band and has not been approved yet.`,
    );
  }
  if (offer.expiresAt && offer.expiresAt.getTime() <= Date.now()) {
    blockers.push("The expiry date is in the past.");
  }
  return blockers;
}
