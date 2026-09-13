import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { syncReminders } from "@/lib/wealth";
import { notifyWealthDue, wealthOwnerIds } from "@/lib/wealth-notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily reminder pass for the Personal Wealth desk.
 *
 * Two jobs, in order:
 *   1. top up the dated instalments so the horizon stays a rolling 12 months —
 *      idempotent, because (holdingId, dueOn, kind) is unique;
 *   2. raise one in-app notification per owner for anything overdue or inside
 *      its lead window, stamping each reminder so it is never raised twice.
 *
 * Scheduled at 01:30 UTC = 07:00 IST, so the nudge lands before the working day
 * rather than in the middle of it.
 *
 * Auth matches the other crons: Bearer CRON_SECRET, or ?key= for a manual run.
 * With CRON_SECRET unset it refuses rather than running anonymously.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — reminders disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` ||
    url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const owners = await wealthOwnerIds();
  let generated = 0;
  let notified = 0;
  const failures: string[] = [];

  for (const ownerUserId of owners) {
    // One owner's bad data must not stop the others from being reminded.
    try {
      generated += await syncReminders(ownerUserId);
      notified += await notifyWealthDue(ownerUserId);
    } catch (e) {
      failures.push(ownerUserId);
      logger.error("wealth_reminder_cron_owner_failed", {
        ownerUserId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  logger.info("wealth_reminder_cron", {
    owners: owners.length,
    generated,
    notified,
    failed: failures.length,
  });
  return NextResponse.json({
    ok: true,
    owners: owners.length,
    generated,
    notified,
    failed: failures.length,
  });
}

export const GET = handle;
export const POST = handle;
