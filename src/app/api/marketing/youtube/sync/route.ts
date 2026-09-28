import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { HttpError, unauthorized, forbidden, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canUseYouTubeInsights, syncYouTube } from "@/lib/youtube/insights";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST /api/marketing/youtube/sync — "Sync now". `{ full: true }` re-pulls all history. */
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!canUseYouTubeInsights(perms)) throw forbidden();
  const body = (await req.json().catch(() => ({}))) as { full?: unknown };
  try {
    const result = await syncYouTube({ full: body.full === true });
    if (!result) throw badRequest("No YouTube channel is connected.", "not_connected");
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // syncYouTube has already recorded the reason on the connection.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sync failed" },
      { status: 502 },
    );
  }
});
