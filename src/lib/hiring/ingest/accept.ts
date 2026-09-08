import { prisma } from "@/lib/prisma";
import { recordPoolEvent } from "../talent-pool";
import { logger } from "@/lib/logger";
import { notFound } from "@/lib/http-error";
import type { ParsedResume } from "../ai/resume-parse";

/**
 * Turning reviewed rows into people.
 *
 * Accepting creates a CANDIDATE and a talent-pool entry. It does not create an
 * application, and there is no option to — putting somebody in the funnel is a
 * separate, deliberate act from knowing they exist. That is what keeps the
 * conversion numbers meaning what they say.
 *
 * A PROPOSED duplicate is never merged unless its id was passed in
 * `confirmedMerges`. Silently merging on weak evidence buries one person's
 * history inside another's, and nobody ever finds out.
 */

/** How long an unsolicited résumé is kept before it should be reviewed again. */
const RETENTION_MONTHS = 24;

export type AcceptOutcome = {
  created: number;
  attached: number;
  skipped: { itemId: string; reason: string }[];
};

export async function acceptItems(opts: {
  itemIds: string[];
  userId: string;
  /** Item ids whose proposed merge a human has explicitly confirmed. */
  confirmedMerges?: string[];
}): Promise<AcceptOutcome> {
  const confirmed = new Set(opts.confirmedMerges ?? []);
  const items = await prisma.hiringIngestItem.findMany({
    where: { id: { in: opts.itemIds } },
    include: { batch: { select: { jobId: true } } },
  });
  if (!items.length) throw notFound("Those rows are no longer there.");

  const outcome: AcceptOutcome = { created: 0, attached: 0, skipped: [] };

  for (const item of items) {
    if (item.status === "accepted") {
      outcome.skipped.push({ itemId: item.id, reason: "Already accepted." });
      continue;
    }
    if (item.status === "unreadable") {
      outcome.skipped.push({ itemId: item.id, reason: "The file could not be read." });
      continue;
    }

    const parsed = item.parsed as unknown as ParsedResume | null;
    if (!parsed) {
      outcome.skipped.push({ itemId: item.id, reason: "Nothing was parsed from this file." });
      continue;
    }

    // A proposal is a question, not a decision.
    if (item.duplicateVia === "proposed" && !confirmed.has(item.id)) {
      outcome.skipped.push({
        itemId: item.id,
        reason: "Looks like an existing candidate — confirm or reject the match first.",
      });
      continue;
    }

    try {
      if (item.duplicateOfId) {
        await attachToExisting(item.duplicateOfId, item.id, parsed, item.blobUrl, item.fileHash);
        outcome.attached++;
      } else {
        await createFromResume(item.id, parsed, item.blobUrl, item.fileHash, opts.userId);
        outcome.created++;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      outcome.skipped.push({ itemId: item.id, reason: message.slice(0, 200) });
      logger.error("hiring_ingest_accept_failed", { itemId: item.id, message });
    }
  }

  logger.info("hiring_ingest_accepted", {
    created: outcome.created,
    attached: outcome.attached,
    skipped: outcome.skipped.length,
  });
  return outcome;
}

/** Fill an existing person's blanks. Never overwrite, never touch human edits. */
async function attachToExisting(
  candidateId: string,
  itemId: string,
  parsed: ParsedResume,
  blobUrl: string | null,
  fileHash: string,
): Promise<void> {
  const existing = await prisma.hiringCandidate.findUnique({ where: { id: candidateId } });
  if (!existing) throw new Error("That candidate no longer exists.");

  const edited = new Set(existing.humanEditedFields);
  const fill = (field: string, value: unknown, current: unknown) =>
    value != null && value !== "" && current == null && !edited.has(field) ? { [field]: value } : {};

  await prisma.$transaction([
    prisma.hiringCandidate.update({
      where: { id: candidateId },
      data: {
        ...fill("currentTitle", parsed.currentTitle, existing.currentTitle),
        ...fill("currentEmployer", parsed.currentEmployer, existing.currentEmployer),
        ...fill("locationText", parsed.locationText, existing.locationText),
        ...fill("totalExperienceYears", parsed.totalExperienceYears, existing.totalExperienceYears),
        ...fill("noticePeriodDays", parsed.noticePeriodDays, existing.noticePeriodDays),
        // The newer résumé becomes the one on file only if there wasn't one.
        ...(blobUrl && !existing.resumeUrl ? { resumeUrl: blobUrl, resumeHash: fileHash } : {}),
        tags: [...new Set([...existing.tags, ...parsed.skills])].slice(0, 40),
      },
    }),
    prisma.hiringIngestItem.update({
      where: { id: itemId },
      data: { status: "accepted", candidateId },
    }),
  ]);
}

async function createFromResume(
  itemId: string,
  parsed: ParsedResume,
  blobUrl: string | null,
  fileHash: string,
  userId: string,
): Promise<void> {
  const candidate = await prisma.hiringCandidate.create({
    data: {
      fullName: parsed.fullName?.trim() || "Unnamed candidate",
      email: parsed.email,
      phone: parsed.phone,
      currentTitle: parsed.currentTitle,
      currentEmployer: parsed.currentEmployer,
      locationText: parsed.locationText,
      totalExperienceYears: parsed.totalExperienceYears,
      noticePeriodDays: parsed.noticePeriodDays,
      resumeUrl: blobUrl,
      resumeHash: fileHash,
      tags: parsed.skills.slice(0, 40),
      source: "resume_import",
      sourceDetail: "Bulk résumé import",
      createdById: userId,
      ownerId: userId,
      // They did not apply to us. No consent, an explicit retention window, and
      // the talent pool rather than the pipeline.
      consentAt: null,
      dataRetentionUntil: new Date(Date.now() + RETENTION_MONTHS * 30 * 86_400_000),
    },
  });

  await prisma.$transaction([
    prisma.hiringTalentPool.upsert({
      where: { candidateId: candidate.id },
      create: {
        candidateId: candidate.id,
        state: "shortlisted",
        interestAreas: parsed.skills.slice(0, 6),
        ownerId: userId,
        lastTouchAt: null,
      },
      update: {},
    }),
    prisma.hiringIngestItem.update({
      where: { id: itemId },
      data: { status: "accepted", candidateId: candidate.id },
    }),
  ]);

  await recordPoolEvent({
    candidateId: candidate.id,
    type: "added",
    toState: "shortlisted",
    note: "Imported from a résumé.",
    actorId: userId,
  });
}

/** Reject a row: keep it, mark it, so the file is not silently re-read forever. */
export async function rejectItems(itemIds: string[]): Promise<number> {
  const { count } = await prisma.hiringIngestItem.updateMany({
    where: { id: { in: itemIds }, status: { notIn: ["accepted"] } },
    data: { status: "rejected" },
  });
  return count;
}
