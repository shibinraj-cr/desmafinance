import { NextResponse } from "next/server";
import { getEtimeConfig, fetchInOutPunchData } from "@/lib/etimeoffice";
import { ingestParsedAttendance, ATTENDANCE_API_CUTOVER } from "@/lib/hr-attendance-ingest";
import { checkAndNotifyExpiry } from "@/lib/etimeoffice-subscription";

export const dynamic = "force-dynamic";
// Give the payroll-touching pipeline room to run on the platform's cron.
export const maxDuration = 300;

/**
 * Automatic scheduled eTimeOffice attendance sync (Vercel Cron → see vercel.json;
 * currently 10:00 / 14:00 / 19:00 IST — the intra-day runs catch out-punches as
 * they accumulate through the day).
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. We also accept
 * `?key=$CRON_SECRET` for manual/curl triggering. If CRON_SECRET is unset the
 * endpoint refuses to run (fail closed) so it can't be hit anonymously.
 *
 * Window: it re-pulls a trailing lookback (default 10 days, ETIMEOFFICE_SYNC_LOOKBACK_DAYS)
 * so late punch edits / regularisations on the biometric side are picked up,
 * but the fromDate is ALWAYS clamped to the cutover (2026-07-01) so nothing
 * before it is ever touched. Re-imports are idempotent.
 */
async function handle(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set — cron sync disabled" }, { status: 503 });
  }
  const url = new URL(req.url);
  const authed =
    req.headers.get("authorization") === `Bearer ${secret}` || url.searchParams.get("key") === secret;
  if (!authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Subscription renewal alerts run on every scheduled tick, independent of the
  // sync credentials (best-effort, deduped so it fires once per threshold).
  const expiryAlert = await checkAndNotifyExpiry();

  const cfg = await getEtimeConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, skipped: "eTimeOffice not configured", expiryAlert }, { status: 200 });
  }

  const n = new Date();
  const today = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  const lookback = Number(process.env.ETIMEOFFICE_SYNC_LOOKBACK_DAYS) || 10;
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - Math.max(0, lookback - 1));
  const fromDate = from > ATTENDANCE_API_CUTOVER ? from : ATTENDANCE_API_CUTOVER;

  try {
    const fetched = await fetchInOutPunchData({ fromDate, toDate: today, cfg });
    const result = await ingestParsedAttendance(fetched.rows, {
      filename: `eTimeOffice cron ${fetched.rangeStart}–${fetched.rangeEnd}`,
      userId: null,
      source: "etimeoffice",
      dateFloor: ATTENDANCE_API_CUTOVER,
      warnings: fetched.warnings,
    });
    return NextResponse.json({
      ok: true,
      fetched: fetched.fetched,
      range: { from: fetched.rangeStart, to: fetched.rangeEnd },
      months: result.months.map((m) => ({ monthKey: m.monthKey, inserted: m.inserted, unmatched: m.unmatched })),
      unmatchedNames: result.unmatchedNames,
      expiryAlert,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "sync failed" },
      { status: 502 },
    );
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
