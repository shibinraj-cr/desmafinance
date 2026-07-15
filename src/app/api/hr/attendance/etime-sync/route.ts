import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { getEtimeConfig, describeConfig, fetchInOutPunchData } from "@/lib/etimeoffice";
import { ingestParsedAttendance, ATTENDANCE_API_CUTOVER } from "@/lib/hr-attendance-ingest";

export const dynamic = "force-dynamic";

function parseIsoDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function todayUtc(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

/** GET → config status (no secrets), so the UI can tell if sync is wired up. */
export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const cfg = await getEtimeConfig();
  return NextResponse.json({
    configured: !!cfg,
    cutover: ATTENDANCE_API_CUTOVER.toISOString().slice(0, 10),
    config: cfg ? describeConfig(cfg) : null,
  });
}

/**
 * Manual "Sync now" from eTimeOffice. Body (optional): { fromDate, toDate } as
 * YYYY-MM-DD. The fromDate is ALWAYS clamped to the cutover (2026-07-01) — a
 * sync can never reach back into the historical .xls data. Defaults: fromDate =
 * cutover, toDate = today.
 */
export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { fromDate?: string; toDate?: string };

  const requestedFrom = parseIsoDate(body.fromDate);
  // Hard floor: never before the cutover, whatever the caller asked for.
  const fromDate =
    requestedFrom && requestedFrom > ATTENDANCE_API_CUTOVER ? requestedFrom : ATTENDANCE_API_CUTOVER;
  const toDate = parseIsoDate(body.toDate) ?? todayUtc();

  if (toDate < fromDate) {
    return NextResponse.json({ error: "toDate is before the fromDate/cutover" }, { status: 400 });
  }

  const cfg = await getEtimeConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "eTimeOffice is not configured. Set the ETIMEOFFICE_* env vars (or AppSetting keys)." },
      { status: 503 },
    );
  }

  let fetched;
  try {
    fetched = await fetchInOutPunchData({ fromDate, toDate, cfg });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "eTimeOffice fetch failed" },
      { status: 502 },
    );
  }

  const result = await ingestParsedAttendance(fetched.rows, {
    filename: `eTimeOffice sync ${fetched.rangeStart}–${fetched.rangeEnd}`,
    userId: userId ?? null,
    source: "etimeoffice",
    dateFloor: ATTENDANCE_API_CUTOVER,
    warnings: fetched.warnings,
  });

  return NextResponse.json({
    fetched: fetched.fetched,
    cutover: ATTENDANCE_API_CUTOVER.toISOString().slice(0, 10),
    requestedRange: { from: fetched.rangeStart, to: fetched.rangeEnd },
    months: result.months,
    salaryRuns: result.salaryRuns,
    rangeStart: result.rangeStart,
    rangeEnd: result.rangeEnd,
    unmatchedNames: result.unmatchedNames,
    warnings: result.warnings,
  });
}
