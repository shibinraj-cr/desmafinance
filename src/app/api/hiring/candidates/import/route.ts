import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { logger } from "@/lib/logger";
import { requireHiring } from "@/lib/hiring/access";
import { submitApplication } from "@/lib/hiring/apply";
import {
  parseCsv,
  guessMapping,
  mapRows,
  previewImport,
  num,
  IMPORT_FIELDS,
  type ImportField,
} from "@/lib/hiring/csv-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;

const schema = z.object({
  mode: z.enum(["preview", "commit"]),
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  jobId: z.string().min(1),
  /** column index -> field. Omitted on the first preview, which guesses. */
  mapping: z.record(z.enum(IMPORT_FIELDS).nullable()).optional(),
});

/**
 * POST /api/hiring/candidates/import
 *
 * Two passes on purpose. `preview` reports what would happen — new people,
 * people already in the system, and the rows it cannot use, with row numbers —
 * and `commit` does it. Nothing is written until someone has read the preview.
 */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireHiring("candidate:write");
  const body = schema.parse(await req.json());

  const { headers, rows } = parseCsv(body.csv);
  if (headers.length === 0) throw badRequest("That file has no header row.", "no_headers");
  if (rows.length === 0) throw badRequest("That file has a header but no rows.", "no_rows");
  if (rows.length > MAX_ROWS) {
    throw badRequest(`That file has ${rows.length} rows; ${MAX_ROWS} is the most per import.`, "too_many_rows");
  }

  const mapping: Record<number, ImportField | null> = body.mapping
    ? Object.fromEntries(Object.entries(body.mapping).map(([k, v]) => [Number(k), v]))
    : guessMapping(headers);

  if (!Object.values(mapping).includes("fullName")) {
    throw badRequest("Map one column to Name — an import needs at least that.", "no_name_column");
  }

  const { parsed, problems } = mapRows(rows, mapping);
  const preview = await previewImport(parsed, problems, body.jobId);

  if (body.mode === "preview") {
    return NextResponse.json({
      headers,
      mapping,
      rowCount: rows.length,
      willCreate: preview.toCreate.length,
      willAttach: preview.existing.filter((e) => !e.alreadyOnThisJob).length,
      alreadyOnJob: preview.existing.filter((e) => e.alreadyOnThisJob).length,
      problems: preview.problems,
      sample: preview.toCreate.slice(0, 10).map((r) => ({
        rowNumber: r.rowNumber,
        fullName: r.fullName,
        email: r.email,
        phone: r.phone,
      })),
    });
  }

  // Commit. Each row goes through the SAME intake as a public application, so
  // dedupe, the created event and the must-have flag behave identically.
  let created = 0;
  let attached = 0;
  const failures: { rowNumber: number; reason: string }[] = [];

  for (const row of [...preview.toCreate, ...preview.existing]) {
    try {
      const result = await submitApplication({
        jobId: body.jobId,
        fullName: row.fullName,
        email: row.email,
        phone: row.phone,
        currentTitle: row.values.currentTitle ?? null,
        currentEmployer: row.values.currentEmployer ?? null,
        locationText: row.values.locationText ?? null,
        linkedinUrl: row.values.linkedinUrl ?? null,
        portfolioUrl: row.values.portfolioUrl ?? null,
        noticePeriodDays: num(row.values.noticePeriodDays),
        expectedCtcLakh: num(row.values.expectedCtcLakh),
        source: "csv_import",
        sourceDetail: `Imported by ${access.userId}`,
        createdById: access.userId,
        ownerId: access.userId,
        consent: false,
      });
      if (result.matchedExistingCandidate) attached++;
      else created++;
    } catch (e) {
      failures.push({
        rowNumber: row.rowNumber,
        reason: e instanceof Error ? e.message : "Could not import this row.",
      });
    }
  }

  logger.info("hiring_csv_import", { jobId: body.jobId, created, attached, failed: failures.length });

  return NextResponse.json({
    created,
    attached,
    failures: [...preview.problems.map((p) => ({ rowNumber: p.rowNumber, reason: p.reason })), ...failures],
  });
});
