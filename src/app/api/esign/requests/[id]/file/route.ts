import { head } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { forbidden, notFound, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { AGREEMENTS_PAGE } from "@/lib/esign/requests";
import { servePrivatePdf } from "@/lib/esign/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/esign/requests/[id]/file?kind=original|current|signed — the PDF as
 * sent, as it stands now (after the signers so far), or the sealed copy.
 * Agreement users may read any; a DESMA signer may read the one they sign.
 */
export const GET = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  const request = await prisma.esignRequest.findUnique({
    where: { id: params.id },
    select: { reference: true, originalPathname: true, currentPathname: true, signedPathname: true, signers: { select: { userId: true } } },
  });
  if (!request) throw notFound("That agreement no longer exists.");
  const isSeat = request.signers.some((s) => s.userId === userId);
  if (!(perms && canSeePage(perms, AGREEMENTS_PAGE)) && !isSeat) throw forbidden();

  const kind = new URL(req.url).searchParams.get("kind") ?? "original";
  const pathname =
    kind === "signed" ? request.signedPathname : kind === "current" ? request.currentPathname ?? request.originalPathname : request.originalPathname;
  if (!pathname) throw notFound(kind === "signed" ? "This agreement is not fully signed yet." : "This agreement has no PDF yet — it has not been sent.");
  const size = (await head(pathname).catch(() => null))?.size;
  if (size === undefined) throw notFound("That file is no longer in storage.");
  const suffix = kind === "signed" ? " (signed)" : "";
  return servePrivatePdf({ blobPathname: pathname, fileName: `${request.reference}${suffix}.pdf`, fileSize: size }, req);
});
