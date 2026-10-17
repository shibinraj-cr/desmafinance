import { head } from "@vercel/blob";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { publicSigner } from "@/lib/esign/public-signer";
import { servePrivatePdf } from "@/lib/esign/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/sign/[token]/file — the agreement as it stands for this signer
 * (or, once everyone has signed, the sealed copy). Needs the code's session.
 */
export const GET = withApiHandler(async (req: Request, { params }: { params: { token: string } }) => {
  const { request } = await publicSigner(req, params.token, { needSession: true, allow: ["open", "done"] });
  const pathname = request.signedPathname ?? request.currentPathname ?? request.originalPathname;
  if (!pathname) throw notFound("The agreement file is not ready.");
  const size = (await head(pathname).catch(() => null))?.size;
  if (size === undefined) throw notFound("That file is no longer in storage.");
  return servePrivatePdf({ blobPathname: pathname, fileName: `${request.reference}.pdf`, fileSize: size }, req);
});
