import { waitUntil } from "@vercel/functions";
import { logger } from "@/lib/logger";
import { redact } from "./secrets";
import { advanceRun } from "./engine";

/**
 * Continue a run AFTER the HTTP response has gone out. On Vercel, waitUntil
 * keeps the function alive (up to the route's maxDuration) so "Run Now" can
 * answer immediately while the browser download runs in the background; the
 * UI polls the run. If the function is cut short, the run's lease lapses and
 * the 5-minute cron (/api/cron/bank-statements) carries it on — nothing is
 * ever lost by a killed function, only delayed.
 */
export const BACKGROUND_BUDGET_MS = 270_000;

export function continueInBackground(runId: string): void {
  waitUntil(
    advanceRun(runId, Date.now() + BACKGROUND_BUDGET_MS).catch((e) =>
      logger.error("bank_background_run_failed", { runId, message: redact(e instanceof Error ? e.message : String(e)) }),
    ),
  );
}
