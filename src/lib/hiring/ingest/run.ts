import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { badRequest, notFound } from "@/lib/http-error";
import { uploadProof, isBlobConfigured } from "@/lib/ops-blob";
import { parseResumeBytes, type ParsedResume } from "../ai/resume-parse";
import { hashFile, classify, isCertain, type ExistingCandidate } from "./dedupe";
import { rankJobs, type JobMatch } from "./match";

/**
 * The ingestion run: files in, reviewable rows out.
 *
 * NOTHING is created from this. A batch produces `HiringIngestItem` rows a
 * human reviews; accepting them is a separate, deliberate act (see `accept`).
 * That separation is the whole point — an ingested résumé is a PERSON we now
 * know about, not an APPLICATION somebody made. Auto-creating applications
 * would put hundreds of people into the funnel who never applied, and every
 * conversion number computed from the event log would become fiction.
 */

export type IncomingFile = {
  name: string;
  bytes: Buffer;
  contentType: string;
  /** Drive file id, when the batch came from a folder. */
  externalId?: string | null;
};

export type IngestOutcome = {
  batchId: string;
  parsed: number;
  duplicates: number;
  unreadable: number;
  /** Skipped for free because an earlier request in this batch read them. */
  alreadyRead: number;
};

/**
 * Run a batch. Each file is handled independently: one unreadable PDF must not
 * cost the other 299 their parse.
 */
export async function runIngest(opts: {
  jobId: string;
  files: IncomingFile[];
  userId: string;
  sourceId?: string | null;
  origin?: "drive" | "upload";
  /** Append to an open batch instead of starting one, so an upload sent in
   *  chunks reviews as a single set. */
  existingBatchId?: string | null;
}): Promise<IngestOutcome> {
  if (!opts.files.length) throw badRequest("No files to read.", "no_files");

  const job = await prisma.hiringJob.findFirst({
    where: { id: opts.jobId, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!job) throw notFound("That requisition no longer exists.");

  // Every open req, for the free cross-match. Read once, not per file.
  const openJobs = await prisma.hiringJob.findMany({
    where: { deletedAt: null, status: { in: ["live", "paused"] } },
    select: { id: true, title: true, mustHaves: true, niceToHaves: true, seniority: true },
  });

  const existing = opts.existingBatchId
    ? await prisma.hiringIngestBatch.findFirst({
        where: { id: opts.existingBatchId, jobId: opts.jobId, status: { in: ["parsing", "review"] } },
      })
    : null;

  const batch =
    existing ??
    (await prisma.hiringIngestBatch.create({
      data: {
        jobId: opts.jobId,
        sourceId: opts.sourceId ?? null,
        origin: opts.origin ?? "upload",
        status: "parsing",
        fileCount: 0,
        createdById: opts.userId,
      },
    }));

  let parsed = 0;
  let duplicates = 0;
  let unreadable = 0;
  /** Files this request skipped because a previous one already read them. */
  let skippedAlreadyRead = 0;

  for (const file of opts.files) {
    const fileHash = hashFile(file.bytes);

    try {
      // Already read in this batch? Then this is a retry of an interrupted run,
      // and re-parsing would charge again for work already paid for. Checked
      // FIRST, because a resumed import is the common case after a timeout.
      const alreadyRead = await prisma.hiringIngestItem.findUnique({
        where: { batchId_fileHash: { batchId: batch.id, fileHash } },
        select: { id: true, status: true },
      });
      if (alreadyRead) {
        skippedAlreadyRead++;
        continue;
      }

      // The cheapest rung next: a file already on somebody's record costs
      // nothing to recognise, and must not cost a parse.
      const byHash = await prisma.hiringCandidate.findFirst({
        where: { resumeHash: fileHash, deletedAt: null },
        select: { id: true, fullName: true },
      });
      if (byHash) {
        await recordItem(batch.id, {
          fileName: file.name,
          externalId: file.externalId ?? null,
          fileHash,
          status: "duplicate",
          duplicateOfId: byHash.id,
          duplicateVia: "hash",
          error: `Already on ${byHash.fullName}'s record.`,
        });
        duplicates++;
        continue;
      }

      const fields = await parseResumeBytes({
        bytes: file.bytes,
        contentType: file.contentType,
        userId: opts.userId,
        entityType: "HiringIngestBatch",
        entityId: batch.id,
      });

      // A parse with no name and no way to reach them is not a candidate.
      if (!fields.fullName && !fields.email && !fields.phone) {
        await recordItem(batch.id, {
          fileName: file.name,
          externalId: file.externalId ?? null,
          fileHash,
          status: "unreadable",
          parsed: fields,
          error: "No name and no contact details could be read — likely a scan.",
        });
        unreadable++;
        continue;
      }

      const dedupe = classify(
        {
          fileHash,
          fullName: fields.fullName ?? file.name,
          email: fields.email,
          phone: fields.phone,
          currentEmployer: fields.currentEmployer,
        },
        await narrowCandidates(fields),
      );

      const blobUrl = isBlobConfigured()
        ? await uploadProof(
            `hiring/ingest/${batch.id}/${safeName(file.name)}`,
            file.bytes,
            file.contentType || "application/pdf",
          )
        : null;

      await recordItem(batch.id, {
        fileName: file.name,
        externalId: file.externalId ?? null,
        fileHash,
        blobUrl,
        // A certain duplicate is filed as one; a PROPOSED match is still parsed
        // and reviewable, because the human has to decide.
        status: isCertain(dedupe) ? "duplicate" : "parsed",
        parsed: fields,
        duplicateOfId: dedupe.candidateId,
        duplicateVia: dedupe.kind === "none" ? null : dedupe.kind,
        error: isCertain(dedupe) ? dedupe.reason : null,
        suggestions: rankJobs(
          { currentTitle: fields.currentTitle, skills: fields.skills, totalExperienceYears: fields.totalExperienceYears },
          openJobs,
        ),
      });

      if (isCertain(dedupe)) duplicates++;
      else parsed++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await recordItem(batch.id, {
        fileName: file.name,
        externalId: file.externalId ?? null,
        fileHash,
        status: "unreadable",
        error: message.slice(0, 400),
      });
      unreadable++;
      logger.error("hiring_ingest_file_failed", { batchId: batch.id, file: file.name, message });
    }
  }

  // Counters accumulate, since a batch may be filled over several requests.
  await prisma.hiringIngestBatch.update({
    where: { id: batch.id },
    data: {
      status: "review",
      // Re-sent files are not new files; counting them would inflate the batch.
      fileCount: { increment: opts.files.length - skippedAlreadyRead },
      parsedCount: { increment: parsed },
      skippedCount: { increment: duplicates },
      failedCount: { increment: unreadable },
    },
  });

  logger.info("hiring_ingest_batch", {
    batchId: batch.id, parsed, duplicates, unreadable, skippedAlreadyRead,
  });
  return { batchId: batch.id, parsed, duplicates, unreadable, alreadyRead: skippedAlreadyRead };
}

/**
 * Only the candidates worth comparing against — by hash, exact contact, or a
 * shared name. Loading every candidate to dedupe one résumé would not scale
 * past the first few thousand.
 */
async function narrowCandidates(fields: ParsedResume): Promise<ExistingCandidate[]> {
  const or: Record<string, unknown>[] = [];
  if (fields.email) or.push({ email: fields.email });
  if (fields.phone) or.push({ phone: fields.phone });
  if (fields.fullName) {
    // A loose contains on the first token; `classify` does the strict work.
    const token = fields.fullName.trim().split(/\s+/)[0];
    if (token && token.length > 2) or.push({ fullName: { contains: token, mode: "insensitive" } });
  }
  if (!or.length) return [];

  const rows = await prisma.hiringCandidate.findMany({
    where: { deletedAt: null, OR: or as never },
    select: { id: true, fullName: true, email: true, phone: true, resumeHash: true, currentEmployer: true },
    take: 50,
  });
  return rows;
}

async function recordItem(
  batchId: string,
  data: {
    fileName: string;
    externalId: string | null;
    fileHash: string;
    blobUrl?: string | null;
    status: string;
    parsed?: ParsedResume;
    duplicateOfId?: string | null;
    duplicateVia?: string | null;
    suggestions?: JobMatch[];
    error?: string | null;
  },
): Promise<void> {
  await prisma.hiringIngestItem.upsert({
    // The same file twice in one batch is one row, not two.
    where: { batchId_fileHash: { batchId, fileHash: data.fileHash } },
    create: {
      batchId,
      fileName: data.fileName,
      externalId: data.externalId,
      fileHash: data.fileHash,
      blobUrl: data.blobUrl ?? null,
      status: data.status,
      parsed: (data.parsed ?? undefined) as never,
      duplicateOfId: data.duplicateOfId ?? null,
      duplicateVia: data.duplicateVia ?? null,
      suggestions: (data.suggestions ?? undefined) as never,
      error: data.error ?? null,
    },
    update: {},
  });
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "resume.pdf";
}
