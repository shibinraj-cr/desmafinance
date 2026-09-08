import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import type { ParsedResume } from "@/lib/hiring/ai/resume-parse";
import type { JobMatch } from "@/lib/hiring/ingest/match";

export const dynamic = "force-dynamic";

// GET /api/hiring/ingest/[batchId] — everything the review screen needs.
export const GET = withApiHandler(async (_req: Request, { params }: { params: { batchId: string } }) => {
  await requireHiring("candidate:write");

  const batch = await prisma.hiringIngestBatch.findUnique({
    where: { id: params.batchId },
    include: {
      job: { select: { id: true, title: true } },
      items: {
        orderBy: [{ status: "asc" }, { fileName: "asc" }],
        include: { candidate: { select: { id: true, fullName: true } } },
      },
    },
  });
  if (!batch) throw notFound("That batch no longer exists.");

  // Name the people a proposed merge points at, so the reviewer is deciding
  // about a person rather than an id.
  const dupIds = batch.items.map((i) => i.duplicateOfId).filter((v): v is string => !!v);
  const dups = dupIds.length
    ? await prisma.hiringCandidate.findMany({
        where: { id: { in: dupIds } },
        select: { id: true, fullName: true, email: true, phone: true, currentEmployer: true },
      })
    : [];
  const byId = new Map(dups.map((d) => [d.id, d]));

  return NextResponse.json({
    batch: {
      id: batch.id,
      jobId: batch.job.id,
      jobTitle: batch.job.title,
      origin: batch.origin,
      status: batch.status,
      fileCount: batch.fileCount,
      parsedCount: batch.parsedCount,
      skippedCount: batch.skippedCount,
      failedCount: batch.failedCount,
    },
    items: batch.items.map((i) => {
      const parsed = i.parsed as unknown as ParsedResume | null;
      const dup = i.duplicateOfId ? byId.get(i.duplicateOfId) : null;
      return {
        id: i.id,
        fileName: i.fileName,
        status: i.status,
        blobUrl: i.blobUrl,
        error: i.error,
        aiScore: i.aiScore,
        aiScoreBreakdown: i.aiScoreBreakdown,
        acceptedCandidateId: i.candidate?.id ?? null,
        parsed: parsed
          ? {
              fullName: parsed.fullName,
              email: parsed.email,
              phone: parsed.phone,
              currentTitle: parsed.currentTitle,
              currentEmployer: parsed.currentEmployer,
              locationText: parsed.locationText,
              totalExperienceYears: parsed.totalExperienceYears,
              skills: parsed.skills,
              confidence: parsed.confidence,
            }
          : null,
        duplicate: dup
          ? {
              id: dup.id,
              fullName: dup.fullName,
              email: dup.email,
              phone: dup.phone,
              currentEmployer: dup.currentEmployer,
              via: i.duplicateVia,
              /** Only a `proposed` match asks the reviewer to decide. */
              needsConfirmation: i.duplicateVia === "proposed",
            }
          : null,
        suggestions: (i.suggestions as unknown as JobMatch[] | null) ?? [],
      };
    }),
  });
});
