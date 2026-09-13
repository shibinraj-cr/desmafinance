import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { isBlobConfigured, uploadProof } from "@/lib/ops-blob";
import { requireSopAccess } from "@/lib/sop/access";
import { AttachmentLinkSchema } from "@/lib/sop/schemas";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { recordSopAudit } from "@/lib/sop/audit";
import {
  ALLOWED_ATTACHMENT_MIME,
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  isAttachmentType,
} from "@/lib/sop/constants";
import { safeHref } from "@/lib/sop/richtext";

export const dynamic = "force-dynamic";

/**
 * POST — attach a related document (§21).
 *
 * Two content types, one route:
 *   - `application/json` for an external link (Drive, a policy URL, a video),
 *   - `multipart/form-data` for a file, which goes to the same Vercel Blob
 *     store the Operations module already uses. We store the URL, never a blob
 *     in Postgres.
 *
 * Upload validation is server-side and by allow-list: the file input's `accept`
 * attribute is a convenience for the picker and is never trusted (§29).
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { versionId: string } }) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const d = AttachmentLinkSchema.parse(await req.json().catch(() => null));
    const href = safeHref(d.linkUrl);
    if (!href) throw badRequest("Only http(s) and mailto links are allowed.", "bad_link");

    const created = await prisma.sopAttachment.create({
      data: {
        versionId: version.id,
        title: d.title,
        docType: d.docType,
        linkUrl: href,
        docVersion: d.docVersion ?? null,
        uploadedById: access.userId,
      },
    });
    await audit(version, access.userId, d.title);
    return NextResponse.json({ attachment: created }, { status: 201 });
  }

  if (!contentType.includes("multipart/form-data")) {
    throw badRequest("Send JSON for a link, or multipart/form-data for a file.", "bad_content_type");
  }
  if (!isBlobConfigured()) {
    throw badRequest(
      "File storage is not configured on this environment — attach a link instead.",
      "blob_unconfigured",
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("No file was sent.", "no_file");

  const title = String(form.get("title") ?? file.name).trim().slice(0, 200);
  if (!title) throw badRequest("Give the document a title.", "no_title");

  const rawType = String(form.get("docType") ?? "other");
  const docType = isAttachmentType(rawType) ? rawType : "other";
  const docVersion = String(form.get("docVersion") ?? "").trim().slice(0, 60) || null;

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw badRequest(
      `That file is larger than the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB limit.`,
      "file_too_large",
    );
  }
  const ext = ALLOWED_ATTACHMENT_MIME[file.type];
  if (!ext) {
    throw badRequest(
      "That file type is not allowed. Attach a document, spreadsheet, presentation, PDF, CSV or image.",
      "bad_file_type",
    );
  }

  const buffer = await file.arrayBuffer();
  // The blob path never contains user-controlled text — the original name is
  // kept in the database column instead, so a hostile filename cannot shape a
  // storage key.
  const url = await uploadProof(`sop/${version.sopId}/${version.id}.${ext}`, buffer, file.type);

  const created = await prisma.sopAttachment.create({
    data: {
      versionId: version.id,
      title,
      docType,
      fileUrl: url,
      fileName: file.name.slice(0, 255),
      mimeType: file.type,
      sizeBytes: file.size,
      docVersion,
      uploadedById: access.userId,
    },
  });

  await audit(version, access.userId, title);
  return NextResponse.json({ attachment: created }, { status: 201 });
});

/** Attachment types, for the picker. */
export const GET = withApiHandler(async () => {
  await requireSopAccess();
  return NextResponse.json({ docTypes: ATTACHMENT_TYPES });
});

async function audit(
  version: { sopId: string; id: string; versionLabel: string },
  userId: string,
  title: string,
) {
  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId,
    action: "ATTACHMENT_ADDED",
    newValue: title,
  });
}
