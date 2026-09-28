import { NextResponse } from "next/server";
import { syncYouTube } from "@/lib/youtube/insights";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily YouTube Insights sync — refreshes uploads and re-pulls the last week
 * of channel analytics (YouTube revises recent days). Scheduled at 8:00 IST in
 * vercel.json. No-op when no channel is connected.
 *
 * Auth matches the other crons: `Authorization: Bearer $CRON_SECRET` from
 * Vercel, or `?key=` for a manual trigger. Fail-closed when the secret is unset.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — YouTube sync disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await syncYouTube();
    return NextResponse.json({ ok: true, connected: result !== null, result });
  } catch (e) {
    console.error("[youtube-sync] failed:", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
