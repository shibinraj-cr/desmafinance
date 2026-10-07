import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { redact } from "@/lib/bank/secrets";
import { checkMissingStatements, drainRuns, queueDueRuns } from "@/lib/bank/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Bank Statement Automation worker — every 5 minutes (vercel.json).
 *
 *  1. Queue today's scheduled run for each integration whose configured time
 *     (default 09:30 IST) has passed — once per day, claimed atomically.
 *  2. Raise the "no statement for N business days" alert, once per day.
 *  3. Drain: advance queued/running runs (Run Now, backfills, retries waiting
 *     out their backoff, anything a killed function left behind) inside the
 *     time budget. Everything is lease-guarded and idempotent, so overlapping
 *     invocations are harmless.
 *
 * Auth matches the other crons: `Authorization: Bearer $CRON_SECRET` from
 * Vercel, or `?key=` for a manual trigger. Fail-closed when the secret is unset.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — bank statement automation disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed = req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const deadline = Date.now() + 280_000;
  try {
    const queued = await queueDueRuns();
    const missingAlerts = await checkMissingStatements();
    const { advanced } = await drainRuns(deadline);
    return NextResponse.json({ ok: true, queued: queued.length, missingAlerts, advanced });
  } catch (e) {
    logger.error("bank_cron_failed", { message: redact(e instanceof Error ? e.message : String(e)) });
    return NextResponse.json({ ok: false, error: "bank automation cron failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
