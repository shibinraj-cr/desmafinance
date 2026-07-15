import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { parseAttendanceWorkbook } from "@/lib/hr-attendance-parser";
import { ingestParsedAttendance } from "@/lib/hr-attendance-ingest";

/**
 * Upload a biometric attendance .xls / .xlsx (any format supported by
 * `parseAttendanceWorkbook`). The file may span multiple months — the shared
 * ingestion pipeline creates one HrAttendanceUpload per cycle covered and
 * inserts the matching day rows under it.
 *
 * This route does NOT pass a dateFloor: a file upload does a full per-cycle
 * replace (the legacy behaviour). The eTimeOffice API sync uses the same
 * `ingestParsedAttendance` with a floor so it never disturbs historical data.
 */
export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  const filename = (file as unknown as { name?: string }).name ?? null;

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseAttendanceWorkbook(buf);

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "no day rows detected in workbook", warnings: parsed.warnings },
      { status: 400 },
    );
  }

  const result = await ingestParsedAttendance(parsed.rows, {
    filename,
    userId: userId ?? null,
    source: "file",
    warnings: parsed.warnings,
  });

  return NextResponse.json({
    months: result.months,
    salaryRuns: result.salaryRuns,
    rangeStart: result.rangeStart,
    rangeEnd: result.rangeEnd,
    unmatchedNames: result.unmatchedNames,
    warnings: result.warnings,
  });
}
