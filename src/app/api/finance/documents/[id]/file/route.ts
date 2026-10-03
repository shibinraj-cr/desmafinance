import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireFinanceDocsUser, serveFinanceDoc } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/documents/[id]/file — download (default) or, with
 * `?inline=1`, open in the browser.
 */
export const GET = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireFinanceDocsUser();
  const doc = await prisma.financeDocument.findUnique({
    where: { id: params.id },
    select: { name: true, blobPathname: true, contentType: true, size: true },
  });
  if (!doc) throw notFound("That document no longer exists");

  const inline = new URL(req.url).searchParams.get("inline") === "1";
  return serveFinanceDoc(doc, inline ? "inline" : "attachment");
});
