import { NextResponse } from "next/server";
import { drainBroadcasts } from "@/lib/wa/broadcast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The drain's budget below stops well inside this; the ceiling is Vercel's
// (300s is the Pro-plan maximum).
export const maxDuration = 300;

/**
 * Send the next chunk of every due WhatsApp broadcast.
 *
 * This is the primary delivery path: on the Pro plan it fires every five
 * minutes (vercel.json) with a near-five-minute budget, so a campaign of a few
 * thousand drains unattended within the hour. The admin's "Send next" button on
 * /crm/broadcasts drives ONE campaign in the moment. Both call the same
 * bounded, resumable drain, so neither can double-send.
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

  // 280s of sending inside the 300s kill time — the drain stops a send early
  // rather than risk the platform killing one mid-flight.
  const summary = await drainBroadcasts(new Date(), { budgetMs: 280_000 });
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
