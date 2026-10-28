import { NextResponse } from "next/server";
import { runLifecycleSweep } from "@/lib/crm-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The sweep's own budget stops well inside this (Vercel Pro maximum).
export const maxDuration = 300;

/**
 * Daily lead lifecycle sweep — Follow-Up and Re-marketing caps into the
 * Centralised pool (src/lib/crm-lifecycle.ts).
 *
 * Moves nothing until an admin switches a cap on at /crm/lifecycle; with both
 * off it only refreshes the review digest (and that only once a cap is on).
 * `?dryRun=1` reports what a real run would move without writing.
 *
 * Auth matches the other crons: Vercel sends `Authorization: Bearer $CRON_SECRET`,
 * and `?key=` is accepted for manual triggering. Fail-closed when unset.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — lifecycle sweep disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dryRun = url.searchParams.get("dryRun") === "1";
  const result = await runLifecycleSweep({ dryRun, budgetMs: 240_000 });
  // The preview lists are for the admin page; the cron log needs the counts.
  const { preview: _p, review: _r, ...summary } = result;
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
