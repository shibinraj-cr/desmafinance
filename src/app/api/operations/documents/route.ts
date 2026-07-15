import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject } from "@/lib/ops-rbac";
import { serializeDocument } from "@/lib/ops-queries";
import { isBlobConfigured, uploadProof } from "@/lib/ops-blob";
import { isAnalyzableMime } from "@/lib/ops-doc-ai";
import { isAiEnabled } from "@/lib/anthropic";
import { recordOpsActivity } from "@/lib/ops-activity";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

const docInclude = { uploadedBy: { select: { username: true } } };

/** Sanitize a client-supplied filename to a safe blob path segment. */
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() || "file";
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "file";
}

// POST /api/operations/documents — attach a proof file to a step. multipart form
// with `taskId` + `file`. Stores the file in Vercel Blob and records the row;
// image/PDF files are marked `pending` so the client can trigger AI analysis.
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);
  if (!access.isOpsUser) throw forbidden();

  if (!isBlobConfigured()) {
    throw badRequest("File storage is not configured yet (BLOB_READ_WRITE_TOKEN).", "storage_not_configured");
  }

  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("Expected multipart form data.", "bad_form");
  const taskId = form.get("taskId");
  const file = form.get("file");
  if (typeof taskId !== "string" || !taskId) throw badRequest("taskId is required.", "task_required");
  if (!(file instanceof File) || file.size === 0) throw badRequest("A non-empty file is required.", "file_required");

  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED.has(mime)) throw badRequest("Only images (PNG/JPG/WebP/GIF) and PDFs are allowed.", "bad_type");
  if (file.size > MAX_BYTES) throw badRequest("File exceeds the 15 MB limit.", "too_large");

  const step = await prisma.opsTask.findUnique({
    where: { id: taskId },
    select: { id: true, name: true, projectId: true, project: { select: { assignedToId: true } } },
  });
  if (!step) throw notFound();
  if (!canEditProject(access, step.project, userId)) throw forbidden();

  const fileName = safeName(file.name);
  const bytes = await file.arrayBuffer();
  const url = await uploadProof(`ops/proofs/${step.projectId}/${step.id}/${fileName}`, bytes, mime);

  const analyzable = isAnalyzableMime(mime);
  const created = await prisma.opsDocument.create({
    data: {
      taskId: step.id,
      fileName,
      fileUrl: url,
      mimeType: mime,
      sizeBytes: file.size,
      uploadedById: userId,
      aiStatus: analyzable && isAiEnabled() ? "pending" : "skipped",
    },
    include: docInclude,
  });

  await recordOpsActivity({
    projectId: step.projectId,
    taskId: step.id,
    actorId: userId,
    type: "DOCUMENT_ADDED",
    summary: `Proof added on "${step.name}": ${fileName}`,
    metadata: { documentId: created.id, mimeType: mime },
  });

  return NextResponse.json({ document: serializeDocument(created) }, { status: 201 });
});
