import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { siteBaseUrl } from "@/lib/site-url";
import {
  BROADCAST_MEDIA_ROUTE,
  headerMediaProblem,
  isBlobConfigured,
  storeBroadcastMedia,
  type HeaderMediaKind,
} from "@/lib/wa/broadcast-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS: readonly HeaderMediaKind[] = ["image", "video", "document"];

/**
 * POST /api/crm/wa/broadcasts/media — upload a campaign's header media.
 *
 * multipart: `file` + `kind` (the template's header kind). Returns the public
 * URL to put in `headerMediaUrl`. Same gate as creating a broadcast.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkEmail) throw forbidden();

  if (!isBlobConfigured()) {
    throw badRequest("File storage is not configured — paste a public URL instead", "blob_not_configured");
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!(file instanceof File)) throw badRequest("No file uploaded", "no_file");
  if (typeof kind !== "string" || !KINDS.includes(kind as HeaderMediaKind)) {
    throw badRequest("Unknown header media kind", "bad_kind");
  }

  const problem = headerMediaProblem(kind as HeaderMediaKind, file.type, file.size);
  if (problem) throw badRequest(problem, "bad_media");

  const pathname = await storeBroadcastMedia(kind as HeaderMediaKind, file.name, await file.arrayBuffer(), file.type);
  return NextResponse.json({ url: `${siteBaseUrl(req)}${BROADCAST_MEDIA_ROUTE}${pathname}` });
});
