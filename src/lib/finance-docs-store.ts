import { get, del, head, issueSignedToken, presignUrl } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { forbidden, notFound, unauthorized } from "@/lib/http-error";
import {
  FINANCE_DOCS_PAGE,
  STREAM_LIMIT_BYTES,
  contentDisposition,
  descendantFolderIds,
  shareState,
} from "@/lib/finance-docs";

/**
 * Server-side half of Finance Documents: who may use it, and how a stored file
 * gets back out of the private Blob store. Pure rules are in finance-docs.ts.
 */

export function isBlobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Every Finance Documents API call goes through this. The page grant is the
 * whole rule: whoever can open /finance/documents can upload, rename, delete
 * and share. Admins pass automatically (canSeePage).
 */
export async function requireFinanceDocsUser(): Promise<{ userId: string }> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  if (!perms || !canSeePage(perms, FINANCE_DOCS_PAGE)) throw forbidden();
  return { userId };
}

/** A same-named sibling folder, compared the way a person reads names (case-blind). */
export async function siblingNamed(name: string, parentId: string | null, exceptId?: string) {
  return prisma.financeDocFolder.findFirst({
    where: {
      parentId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
}

/** Size and type of an uploaded blob, or null when nothing is there. */
export async function headFinanceBlob(pathname: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const h = await head(pathname);
    return { size: h.size, contentType: h.contentType || "application/octet-stream" };
  } catch {
    return null;
  }
}

/** Best-effort: a stray blob costs storage, a failed DB delete would cost more. */
export async function deleteFinanceBlob(pathname: string): Promise<void> {
  try {
    await del(pathname);
  } catch {
    /* already gone, or storage hiccup — the record is what matters */
  }
}

type ServableDoc = { name: string; blobPathname: string; contentType: string; size: number };

/**
 * Hand a stored document to the caller.
 *
 * Small files stream through this function so the download carries the
 * document's current display name. Anything past STREAM_LIMIT_BYTES would hit
 * Vercel's 4.5 MB response cap, so it gets a five-minute presigned URL to the
 * object itself instead; the browser keeps the upload-time filename there.
 */
export async function serveFinanceDoc(doc: ServableDoc, kind: "inline" | "attachment"): Promise<Response> {
  if (doc.size > STREAM_LIMIT_BYTES) {
    const validUntil = Date.now() + 5 * 60 * 1000;
    const signed = await issueSignedToken({ pathname: doc.blobPathname, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(signed, {
      operation: "get",
      pathname: doc.blobPathname,
      access: "private",
      validUntil,
    });
    return new Response(null, {
      status: 302,
      headers: { location: presignedUrl, "cache-control": "private, no-store" },
    });
  }

  const result = await get(doc.blobPathname, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw notFound("That file is no longer in storage.");
  }
  return new Response(result.stream as ReadableStream, {
    headers: {
      "content-type": doc.contentType || "application/octet-stream",
      "content-disposition": contentDisposition(kind, doc.name),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Resolve a public share token to what it exposes. `state` is returned rather
 * than thrown so the public page can explain an expired or revoked link.
 */
export async function resolveShare(token: string, now: Date) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const share = await prisma.financeDocShare.findUnique({
    where: { token },
    include: {
      document: { select: { id: true, name: true, contentType: true, size: true, blobPathname: true, createdAt: true } },
      folder: { select: { id: true, name: true } },
    },
  });
  if (!share || (!share.document && !share.folder)) return null;
  return { share, state: shareState(share, now) };
}

/** Every folder and document a folder share reaches, the folder itself included. */
export async function sharedFolderContents(rootId: string) {
  const folders = await prisma.financeDocFolder.findMany({ select: { id: true, name: true, parentId: true } });
  const ids = descendantFolderIds(folders, rootId);
  const documents = await prisma.financeDocument.findMany({
    where: { folderId: { in: Array.from(ids) } },
    select: { id: true, name: true, contentType: true, size: true, folderId: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  return { folders: folders.filter((f) => ids.has(f.id)), documents };
}
