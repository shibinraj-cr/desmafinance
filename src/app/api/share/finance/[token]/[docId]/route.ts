import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { forbidden, notFound } from "@/lib/http-error";
import { descendantFolderIds } from "@/lib/finance-docs";
import { resolveShare, serveFinanceDoc } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/share/finance/[token]/[docId] — PUBLIC download through a share link.
 *
 * Outside the login wall (see middleware). The token is the credential, and it
 * reaches exactly one document, or the documents under one folder, while the
 * link is inside its period and not revoked. Download only: there is no route
 * that writes through a token.
 */
export const GET = withApiHandler(
  async (_req: Request, { params }: { params: { token: string; docId: string } }) => {
    const resolved = await resolveShare(params.token, new Date());
    if (!resolved) throw notFound("This link is not valid.");
    const { share, state } = resolved;
    if (state !== "active") throw forbidden("This link is not active.");

    let allowed = share.documentId === params.docId;
    if (!allowed && share.folderId) {
      const doc = await prisma.financeDocument.findUnique({ where: { id: params.docId }, select: { folderId: true } });
      if (doc?.folderId) {
        const folders = await prisma.financeDocFolder.findMany({ select: { id: true, name: true, parentId: true } });
        allowed = descendantFolderIds(folders, share.folderId).has(doc.folderId);
      }
    }
    if (!allowed) throw notFound("That file is not part of this link.");

    const doc = await prisma.financeDocument.findUnique({
      where: { id: params.docId },
      select: { name: true, blobPathname: true, contentType: true, size: true },
    });
    if (!doc) throw notFound("That file is no longer available.");

    await prisma.financeDocShare.update({
      where: { id: share.id },
      data: { downloadCount: { increment: 1 }, lastAccessedAt: new Date() },
    });
    return serveFinanceDoc(doc, "attachment");
  },
);
