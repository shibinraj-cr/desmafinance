import { del, get, head } from "@vercel/blob";
import { Prisma, type EsignTemplateField } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { recordAudit } from "@/lib/audit";
import { serveFinanceDoc } from "@/lib/finance-docs-store";
import { HttpError, badRequest, conflict, forbidden, notFound, unauthorized, unprocessable } from "@/lib/http-error";
import { PdfRejectedError, inspectPdf, sha256Hex } from "@/lib/esign/pdf";
import {
  AGREEMENT_TEMPLATES_PAGE,
  MAX_TEMPLATE_PDF_BYTES,
  STREAM_LIMIT_BYTES,
  isTemplateUploadPath,
  parseByteRange,
  planFieldSave,
  type PageGeometry,
} from "@/lib/esign/templates";
import {
  ALIGNMENTS,
  SIGNER_ROLES,
  carryFieldsForward,
  normalizeField,
  sortFields,
  validateFields,
  type Alignment,
  type SignerRole,
  type TemplateField,
} from "@/lib/esign/template-fields";

/**
 * Server-side half of agreement templates: who may manage them, how a PDF gets
 * in and back out of the private Blob store, and the database writes that must
 * happen together. Pure rules live in templates.ts / template-fields.ts.
 */

/**
 * Every template API call goes through this. The page grant is the rule:
 * whoever can open /operations/agreements/templates can create and edit
 * templates. Admins pass automatically (canSeePage).
 */
export async function requireTemplateManager(): Promise<{ userId: string }> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  if (!perms || !canSeePage(perms, AGREEMENT_TEMPLATES_PAGE)) throw forbidden();
  return { userId };
}

/** Best-effort: a stray blob costs storage, a failed request would cost more. */
async function deleteBlobQuietly(pathname: string): Promise<void> {
  try {
    await del(pathname);
  } catch {
    /* already gone, or storage hiccup */
  }
}

type IngestedPdf = {
  fileSha256: string;
  fileSize: number;
  numPages: number;
  pages: PageGeometry[];
};

/**
 * Check an uploaded blob is a PDF we can work with and measure it. Size, hash
 * and geometry all come from the stored bytes, never from the browser. A
 * rejected file is deleted so it does not linger in storage.
 */
export async function ingestTemplatePdf(pathname: string): Promise<IngestedPdf> {
  if (!isTemplateUploadPath(pathname)) throw badRequest("Invalid upload path");

  let size: number;
  try {
    size = (await head(pathname)).size;
  } catch {
    throw badRequest("The upload did not finish. Try again.");
  }
  if (size > MAX_TEMPLATE_PDF_BYTES) {
    await deleteBlobQuietly(pathname);
    throw badRequest(`That PDF is over ${MAX_TEMPLATE_PDF_BYTES / (1024 * 1024)} MB.`);
  }

  const result = await get(pathname, { access: "private" });
  if (!result?.stream) throw badRequest("The upload did not finish. Try again.");
  const bytes = new Uint8Array(await new Response(result.stream as ReadableStream).arrayBuffer());

  try {
    const { numPages, pages } = await inspectPdf(bytes);
    return { fileSha256: sha256Hex(bytes), fileSize: bytes.byteLength, numPages, pages };
  } catch (err) {
    if (err instanceof PdfRejectedError) {
      await deleteBlobQuietly(pathname);
      throw unprocessable(err.message, "pdf_rejected");
    }
    throw err;
  }
}

type ServableVersion = { blobPathname: string; fileName: string; fileSize: number };

/**
 * Hand a template PDF to a signed-in caller.
 *
 * With a `Range` header (the builder loading a large file in pieces) the bytes
 * are proxied through this function a chunk at a time, so they never leave via
 * a storage URL. Without one it behaves like a Finance Documents download:
 * small files stream, larger ones get a five-minute presigned link.
 */
export async function serveTemplatePdf(version: ServableVersion, req: Request): Promise<Response> {
  const size = version.fileSize;
  const range = parseByteRange(req.headers.get("range"), size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  if (!range) {
    return serveFinanceDoc(
      { name: version.fileName, blobPathname: version.blobPathname, contentType: "application/pdf", size },
      "inline",
    );
  }

  const result = await get(version.blobPathname, {
    access: "private",
    headers: { range: `bytes=${range.start}-${range.end}` },
  });
  if (!result?.stream) throw notFound("That file is no longer in storage.");
  const headers: Record<string, string> = {
    "content-type": "application/pdf",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };
  const contentRange = result.headers.get("content-range");
  if (contentRange) {
    const length = result.headers.get("content-length");
    return new Response(result.stream as ReadableStream, {
      status: 206,
      headers: { ...headers, "content-range": contentRange, ...(length ? { "content-length": length } : {}) },
    });
  }
  // Storage ignored the range and is sending everything. That is still a
  // correct answer while the whole file fits in one function response.
  if (size <= STREAM_LIMIT_BYTES) {
    return new Response(result.stream as ReadableStream, { status: 200, headers });
  }
  throw new HttpError(502, "File storage did not return the requested part of the PDF.", "range_unsupported");
}

// ─── Rows ⇄ fields ──────────────────────────────────────────────────────────

export function fieldFromRow(row: EsignTemplateField): TemplateField {
  const options = Array.isArray(row.options) ? row.options.filter((o): o is string => typeof o === "string") : null;
  return {
    key: row.key,
    label: row.label,
    type: row.type,
    role: (SIGNER_ROLES as readonly string[]).includes(row.role) ? (row.role as SignerRole) : "Client",
    page: row.page,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    required: row.required,
    options,
    mergeKey: row.mergeKey,
    fontSize: row.fontSize,
    alignment: (ALIGNMENTS as readonly string[]).includes(row.alignment) ? (row.alignment as Alignment) : "left",
  };
}

function fieldRows(versionId: string, fields: TemplateField[]): Prisma.EsignTemplateFieldCreateManyInput[] {
  return sortFields(fields).map((f, i) => ({
    versionId,
    key: f.key,
    label: f.label,
    type: f.type,
    role: f.role,
    page: f.page,
    x: f.x,
    y: f.y,
    w: f.w,
    h: f.h,
    required: f.required,
    options: f.options ?? Prisma.DbNull,
    mergeKey: f.mergeKey,
    fontSize: f.fontSize,
    alignment: f.alignment,
    sortOrder: i,
  }));
}

const asJson = (pages: PageGeometry[]) => pages as unknown as Prisma.InputJsonValue;

/**
 * Lock the template row for the rest of the transaction. Every write that
 * reads-then-writes a template's versions takes this first, so two people
 * saving at once queue instead of interleaving (e.g. both claiming "v4").
 */
async function lockTemplate(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "EsignTemplate" WHERE id = ${id} FOR UPDATE`;
  const template = await tx.esignTemplate.findUnique({
    where: { id },
    select: { id: true, active: true, currentVersionId: true, updatedAt: true },
  });
  if (!template) throw notFound("That template no longer exists.");
  if (!template.active) throw conflict("This template is archived. Restore it before changing it.", "archived");
  return template;
}

async function nextVersionNumber(tx: Prisma.TransactionClient, templateId: string): Promise<number> {
  const top = await tx.esignTemplateVersion.aggregate({ where: { templateId }, _max: { version: true } });
  return (top._max.version ?? 0) + 1;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export type TemplateSettings = {
  name: string;
  category: string;
  description: string | null;
  defaultExpiryDays?: number;
  defaultReminderDays?: number;
  emailSubject?: string | null;
  emailBody?: string | null;
  whatsappTemplateName?: string | null;
};

/**
 * Create a template from an uploaded PDF, as version 1 with no fields. A
 * repeated call for the same upload returns the template already made from it.
 */
export async function createTemplateFromUpload(opts: {
  userId: string;
  settings: TemplateSettings;
  pathname: string;
  fileName: string;
}): Promise<{ templateId: string; created: boolean }> {
  const existing = await prisma.esignTemplateVersion.findFirst({
    where: { blobPathname: opts.pathname },
    select: { templateId: true },
  });
  if (existing) return { templateId: existing.templateId, created: false };

  const file = await ingestTemplatePdf(opts.pathname);
  const templateId = await prisma.$transaction(async (tx) => {
    const t = await tx.esignTemplate.create({ data: { ...opts.settings, createdById: opts.userId } });
    const v = await tx.esignTemplateVersion.create({
      data: {
        templateId: t.id,
        version: 1,
        blobPathname: opts.pathname,
        fileName: opts.fileName,
        fileSha256: file.fileSha256,
        fileSize: file.fileSize,
        numPages: file.numPages,
        pages: asJson(file.pages),
        createdById: opts.userId,
      },
    });
    await tx.esignTemplate.update({ where: { id: t.id }, data: { currentVersionId: v.id } });
    return t.id;
  });
  await recordAudit({
    entityType: "EsignTemplate",
    entityId: templateId,
    action: "CREATE",
    userId: opts.userId,
    changes: { name: opts.settings.name, category: opts.settings.category, fileSha256: file.fileSha256 },
  });
  return { templateId, created: true };
}

/**
 * Make an uploaded PDF the template's next version. The current version's
 * fields come across (fractions travel well between page sizes); boxes on
 * pages the new file lacks are dropped and counted.
 */
export async function addTemplateVersion(opts: {
  templateId: string;
  userId: string;
  pathname: string;
  fileName: string;
  notes: string | null;
}): Promise<{ versionId: string; version: number; carried: number; dropped: number }> {
  const existing = await prisma.esignTemplateVersion.findFirst({
    where: { templateId: opts.templateId, blobPathname: opts.pathname },
    select: { id: true, version: true, _count: { select: { fields: true } } },
  });
  if (existing) return { versionId: existing.id, version: existing.version, carried: existing._count.fields, dropped: 0 };

  const file = await ingestTemplatePdf(opts.pathname);
  const out = await prisma.$transaction(async (tx) => {
    const template = await lockTemplate(tx, opts.templateId);
    const current = template.currentVersionId
      ? await tx.esignTemplateField.findMany({ where: { versionId: template.currentVersionId } })
      : [];
    const { kept, dropped } = carryFieldsForward(current.map(fieldFromRow), file.numPages);
    const version = await nextVersionNumber(tx, opts.templateId);
    const v = await tx.esignTemplateVersion.create({
      data: {
        templateId: opts.templateId,
        version,
        blobPathname: opts.pathname,
        fileName: opts.fileName,
        fileSha256: file.fileSha256,
        fileSize: file.fileSize,
        numPages: file.numPages,
        pages: asJson(file.pages),
        notes: opts.notes,
        createdById: opts.userId,
      },
    });
    if (kept.length) await tx.esignTemplateField.createMany({ data: fieldRows(v.id, kept) });
    await tx.esignTemplate.update({ where: { id: opts.templateId }, data: { currentVersionId: v.id } });
    return { versionId: v.id, version, carried: kept.length, dropped };
  });
  await recordAudit({
    entityType: "EsignTemplate",
    entityId: opts.templateId,
    action: "UPDATE",
    userId: opts.userId,
    changes: { newVersion: out.version, fileSha256: file.fileSha256, fieldsCarried: out.carried, fieldsDropped: out.dropped },
  });
  return out;
}

/**
 * Save the builder's layout for a version. Edits in place while nothing has
 * been sent from it; otherwise forks the next version (same PDF, new layout),
 * so agreements already sent keep the layout they were sent with.
 *
 * `expectedUpdatedAt` is the template's updatedAt when the builder loaded: if
 * someone else saved since, this refuses rather than silently overwriting them.
 */
export async function saveVersionFields(opts: {
  templateId: string;
  versionId: string;
  userId: string;
  fields: TemplateField[];
  expectedUpdatedAt: string | null;
}): Promise<{ versionId: string; version: number; forked: boolean; updatedAt: string }> {
  const version = await prisma.esignTemplateVersion.findFirst({
    where: { id: opts.versionId, templateId: opts.templateId },
    select: { id: true, version: true, numPages: true, blobPathname: true, fileName: true, fileSha256: true, fileSize: true, pages: true },
  });
  if (!version) throw notFound("That template version no longer exists.");

  const fields = opts.fields.map(normalizeField);
  const errors = validateFields(fields, version.numPages);
  if (errors.length) throw unprocessable(errors.join(" "), "invalid_fields");

  const out = await prisma.$transaction(async (tx) => {
    const template = await lockTemplate(tx, opts.templateId);
    if (opts.expectedUpdatedAt && template.updatedAt.getTime() !== new Date(opts.expectedUpdatedAt).getTime()) {
      throw conflict(
        "Someone else changed this template after you opened it. Reload to see their changes, then make your edits again.",
        "template_changed",
      );
    }
    const sentCount = await tx.esignRequest.count({ where: { templateVersionId: version.id } });
    const plan = planFieldSave({ versionId: version.id, currentVersionId: template.currentVersionId, sentCount });
    if (plan === "stale") {
      throw conflict("A newer version of this template was uploaded after you opened it. Reload the builder.", "stale_version");
    }

    let target = { id: version.id, version: version.version };
    if (plan === "fork") {
      const next = await nextVersionNumber(tx, opts.templateId);
      const v = await tx.esignTemplateVersion.create({
        data: {
          templateId: opts.templateId,
          version: next,
          blobPathname: version.blobPathname,
          fileName: version.fileName,
          fileSha256: version.fileSha256,
          fileSize: version.fileSize,
          numPages: version.numPages,
          pages: version.pages as Prisma.InputJsonValue,
          notes: `Field changes; v${version.version} stays as sent (${sentCount} agreement${sentCount === 1 ? "" : "s"}).`,
          createdById: opts.userId,
        },
      });
      target = { id: v.id, version: next };
    } else {
      await tx.esignTemplateField.deleteMany({ where: { versionId: version.id } });
    }
    if (fields.length) await tx.esignTemplateField.createMany({ data: fieldRows(target.id, fields) });
    const t = await tx.esignTemplate.update({
      where: { id: opts.templateId },
      data: { currentVersionId: target.id, updatedAt: new Date() },
      select: { updatedAt: true },
    });
    return { versionId: target.id, version: target.version, forked: plan === "fork", updatedAt: t.updatedAt.toISOString() };
  });
  await recordAudit({
    entityType: "EsignTemplate",
    entityId: opts.templateId,
    action: "UPDATE",
    userId: opts.userId,
    changes: { fieldsSaved: fields.length, version: out.version, forked: out.forked },
  });
  return out;
}

/** Copy a template's settings, current PDF and fields into a new template. */
export async function cloneTemplate(opts: {
  sourceId: string;
  userId: string;
  name: string | null;
}): Promise<{ templateId: string }> {
  const source = await prisma.esignTemplate.findUnique({
    where: { id: opts.sourceId },
    include: { currentVersion: { include: { fields: true } } },
  });
  if (!source) throw notFound("That template no longer exists.");
  const cv = source.currentVersion;
  if (!cv) throw badRequest("This template has no PDF to copy.");

  const templateId = await prisma.$transaction(async (tx) => {
    const t = await tx.esignTemplate.create({
      data: {
        name: (opts.name ?? `${source.name} (copy)`).slice(0, 200),
        category: source.category,
        description: source.description,
        defaultExpiryDays: source.defaultExpiryDays,
        defaultReminderDays: source.defaultReminderDays,
        emailSubject: source.emailSubject,
        emailBody: source.emailBody,
        whatsappTemplateName: source.whatsappTemplateName,
        clonedFromId: source.id,
        createdById: opts.userId,
      },
    });
    const v = await tx.esignTemplateVersion.create({
      data: {
        templateId: t.id,
        version: 1,
        blobPathname: cv.blobPathname,
        fileName: cv.fileName,
        fileSha256: cv.fileSha256,
        fileSize: cv.fileSize,
        numPages: cv.numPages,
        pages: cv.pages as Prisma.InputJsonValue,
        notes: `Copied from "${source.name}" v${cv.version}.`,
        createdById: opts.userId,
      },
    });
    if (cv.fields.length) await tx.esignTemplateField.createMany({ data: fieldRows(v.id, cv.fields.map(fieldFromRow)) });
    await tx.esignTemplate.update({ where: { id: t.id }, data: { currentVersionId: v.id } });
    return t.id;
  });
  await recordAudit({
    entityType: "EsignTemplate",
    entityId: templateId,
    action: "CREATE",
    userId: opts.userId,
    changes: { clonedFromId: source.id, clonedFromVersion: cv.version },
  });
  return { templateId };
}
