import { NextResponse } from "next/server";
import { drainBroadcasts } from "@/lib/wa/broadcast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The drain's own budget stops well inside this; the ceiling is Vercel's.
export const maxDuration = 60;

/**
 * Send the next chunk of every due WhatsApp broadcast.
 *
 * Deliberately NOT the primary path. On the Hobby plan a cron may only fire once
 * a day, and one 60-second pass cannot deliver a campaign of a few thousand — so
 * this is the unattended catch-up, while an admin pressing "Send now" on
 * /crm/broadcasts drives the campaign in the moment. Both call the same bounded,
 * resumable drain, so neither can double-send.
 *
 * Finishing a large campaign on Hobby therefore takes repeated triggers. The
 * honest fixes are Vercel Pro (a minutely cron in vercel.json is then the only
 * change), stacking several daily entries the way etime-sync does, or pinging
 * this endpoint from an external scheduler with `?key=$CRON_SECRET`.
 *
 * Auth matches the other crons: Vercel sends `Authorization: Bearer $CRON_SECRET`,
 * and `?key=` is accepted for manual/external triggering. Fail-closed when unset.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — broadcast drain disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const summary = await drainBroadcasts();
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
