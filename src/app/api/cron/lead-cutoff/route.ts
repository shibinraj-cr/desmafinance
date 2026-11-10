import { NextResponse } from "next/server";
import { runLeadCutoffTick } from "@/lib/crm-lead-cutoff-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The daily lead report's heartbeat, every five minutes (vercel.json), every
 * day — Vercel schedules in UTC, so a Mon–Sat schedule would skip Monday
 * morning IST; the tick itself only reminds and summarises on days with a
 * cutoff. See runLeadCutoffTick for what one tick does.
 *
 * Auth matches the other crons: Vercel sends `Authorization: Bearer $CRON_SECRET`,
 * and `?key=` is accepted for manual triggering. Fail-closed when unset.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — lead cutoff disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const summary = await runLeadCutoffTick(new Date());
  return NextResponse.json({ ok: summary.errors.length === 0, ...summary });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
