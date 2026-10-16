import { head } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireAgreementsUser } from "@/lib/esign/send";
import { servePrivatePdf } from "@/lib/esign/store";

export const dynamic = "force-dynamic";

/** GET /api/esign/requests/[id]/file — the agreement PDF exactly as sent. */
export const GET = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireAgreementsUser();
  const request = await prisma.esignRequest.findUnique({
    where: { id: params.id },
    select: { reference: true, originalPathname: true },
  });
  if (!request?.originalPathname) throw notFound("This agreement has no PDF yet — it has not been sent.");
  const size = (await head(request.originalPathname).catch(() => null))?.size;
  if (size === undefined) throw notFound("That file is no longer in storage.");
  return servePrivatePdf(
    { blobPathname: request.originalPathname, fileName: `${request.reference}.pdf`, fileSize: size },
    req,
  );
});
