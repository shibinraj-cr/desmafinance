import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { requireHiring } from "@/lib/hiring/access";
import { runIngest, type IncomingFile } from "@/lib/hiring/ingest/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
/**
 * Per request, not per batch. A serverless function has 60 seconds and each
 * résumé costs a model round-trip, so the browser sends them in chunks and the
 * batch accumulates. Better a visible "12 of 300" than a request that dies at
 * 60 seconds having written half of nothing.
 */
const MAX_FILES_PER_REQUEST = 12;

// GET /api/hiring/ingest — recent batches.
export const GET = withApiHandler(async () => {
  await requireHiring("candidate:write");
  const batches = await prisma.hiringIngestBatch.findMany({
    include: {
      job: { select: { title: true } },
      createdBy: { select: { username: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return NextResponse.json({
    batches: batches.map((b) => ({
      id: b.id,
      jobTitle: b.job.title,
      origin: b.origin,
      status: b.status,
      fileCount: b.fileCount,
      parsedCount: b.parsedCount,
      skippedCount: b.skippedCount,
      failedCount: b.failedCount,
      itemCount: b._count.items,
      createdByName: b.createdBy?.username ?? null,
      createdAt: b.createdAt.toISOString(),
    })),
  });
});

// POST /api/hiring/ingest — upload a chunk of résumés for one requisition.
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("candidate:write");
  const form = await req.formData();

  const jobId = String(form.get("jobId") ?? "");
  if (!jobId) throw badRequest("Pick the requisition these résumés are for.", "no_job");

  const files: IncomingFile[] = [];
  for (const value of form.getAll("files")) {
    if (!(value instanceof File) || value.size === 0) continue;
    if (value.size > MAX_FILE_BYTES) {
      throw badRequest(`"${value.name}" is over 8 MB.`, "file_too_large");
    }
    files.push({
      name: value.name,
      bytes: Buffer.from(await value.arrayBuffer()),
      contentType: value.type || "application/pdf",
    });
  }

  if (!files.length) throw badRequest("No files were attached.", "no_files");
  if (files.length > MAX_FILES_PER_REQUEST) {
    throw badRequest(
      `Send at most ${MAX_FILES_PER_REQUEST} files at a time — each one costs a model call.`,
      "too_many_files",
    );
  }

  // An existing batch to append to, so a 300-file folder is one reviewable set.
  const batchId = form.get("batchId");
  const outcome = await runIngest({
    jobId,
    files,
    userId: access.userId,
    origin: "upload",
    existingBatchId: typeof batchId === "string" && batchId ? batchId : null,
  });

  return NextResponse.json(outcome, { status: 201 });
});
