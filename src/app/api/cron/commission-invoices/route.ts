import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { runMonthly } from "@/lib/partner-commissions/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Partner Commissions monthly run. Fires daily at 03:00 UTC (08:30 IST); on or
 * after the run day in Settings (the 20th by default) it drafts one invoice per
 * partner from every fully paid, un-invoiced enrollment and alerts Finance by
 * bell and email. At most once per month — a later fire that month is a no-op,
 * and a missed day catches up on the next fire.
 *
 * Auth matches the other crons: Bearer CRON_SECRET, or ?key= for a manual run.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not set — commission run disabled" }, { status: 503 });
  const url = new URL(req.url);
  const authed = req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = await runMonthly();
    logger.info("pc_monthly_run", { ran: result.ran, reason: result.reason, invoices: result.invoices.length });
    return NextResponse.json(result);
  } catch (e) {
    logger.error("pc_monthly_run_failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "run_failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
