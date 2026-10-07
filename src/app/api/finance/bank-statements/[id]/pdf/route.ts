import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { serveFinanceDoc } from "@/lib/finance-docs-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/bank-statements/:id/pdf[?download=1] — the original
 * statement PDF, for users with the download capability only. Served through
 * this route from the private Blob store (never a public URL), and every
 * access is audited.
 */
export const GET = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireBank("download");
  const s = await prisma.bankStatement.findUnique({
    where: { id: params.id },
    select: { id: true, blobPathname: true, fileName: true, fileSize: true },
  });
  if (!s?.blobPathname) throw notFound("No archived PDF for this statement");
  await recordAudit({ entityType: "BankStatement", entityId: s.id, action: "UPDATE", userId, changes: { pdf: "viewed" } });
  const kind = new URL(req.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return serveFinanceDoc(
    { name: s.fileName ?? "statement.pdf", blobPathname: s.blobPathname, contentType: "application/pdf", size: s.fileSize ?? 0 },
    kind,
  );
});
