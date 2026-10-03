import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { isServableBroadcastMediaPath, readBroadcastMedia } from "@/lib/wa/broadcast-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/wa-media/<blob pathname> — serve an uploaded broadcast header.
 *
 * Unauthenticated (excluded in middleware) because Meta fetches it with no
 * session. Only paths under the broadcast-media prefix are readable; see
 * broadcast-media.ts for why that makes a public route safe here.
 */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { path: string[] } }) => {
  const pathname = params.path.map(decodeURIComponent).join("/");
  if (!isServableBroadcastMediaPath(pathname)) throw notFound();

  const file = await readBroadcastMedia(pathname);
  if (!file) throw notFound();

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.contentType,
      // The key carries a random suffix and is never overwritten, so the CDN can
      // hold it indefinitely — a campaign's sends then rarely reach this function.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});
