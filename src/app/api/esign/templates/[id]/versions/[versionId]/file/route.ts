import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireTemplateViewer, servePrivatePdf } from "@/lib/esign/store";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; versionId: string } };

/**
 * GET /api/esign/templates/[id]/versions/[versionId]/file — the version's PDF,
 * whole or (with a Range header) in parts. The version is looked up through
 * its template, so a caller can never name an arbitrary blob. Template managers
 * and agreement senders (who preview it while sending) may read it.
 */
export const GET = withApiHandler(async (req: Request, { params }: Ctx) => {
  await requireTemplateViewer();
  const version = await prisma.esignTemplateVersion.findFirst({
    where: { id: params.versionId, templateId: params.id },
    select: { blobPathname: true, fileName: true, fileSize: true },
  });
  if (!version) throw notFound("That template version no longer exists.");
  return servePrivatePdf(version, req);
});
