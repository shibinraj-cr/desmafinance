import { withApiHandler } from "@/lib/api";
import { notFound, forbidden } from "@/lib/http-error";
import { getHiringAccess } from "@/lib/hiring/access";
import { can } from "@/lib/hiring/rbac";
import { readHiringFile } from "@/lib/hiring/blob";

export const dynamic = "force-dynamic";

/**
 * GET /api/hiring/files/<blob pathname> — serve a stored résumé or offer PDF.
 *
 * The store is private, so these bytes are only reachable through here, and
 * only for somebody who may read candidates. That is the point: a résumé is
 * personal data, and "unguessable URL" is not access control.
 */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { path: string[] } }) => {
  const { access } = await getHiringAccess();
  if (!access) throw forbidden();
  if (!can(access, "candidate:read")) throw forbidden();

  const pathname = params.path.map(decodeURIComponent).join("/");
  const file = await readHiringFile(pathname);
  if (!file) throw notFound("That file is not there any more.");

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.contentType,
      // Shown in the browser rather than downloaded; a recruiter is reading it.
      "content-disposition": "inline",
      // Personal data behind an auth check has no business in a shared cache.
      "cache-control": "private, no-store",
    },
  });
});
