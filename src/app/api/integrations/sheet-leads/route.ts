import { NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { withApiHandler } from "@/lib/api";
import { HttpError, unauthorized, badRequest } from "@/lib/http-error";
import { ingestSheetLeads } from "@/lib/crm-sheet-ingest";
import { getSheetLeadsSecret } from "@/lib/app-settings";
import { recordSheetContact, recordSheetRejection } from "@/lib/sheet-sync-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto + Buffer

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// `rows` may be empty: the Apps Script checks in every run even when it has
// nothing to send, so that silence here means the trigger has stopped rather
// than "the sheet had no new leads". `campaign` rides on real batches only.
const BodySchema = z.object({
  source: z.string().trim().min(1).max(40),
  campaign: z.string().trim().min(1).max(200).optional(),
  rows: z.array(z.record(z.unknown())).max(500).optional().default([]),
});

// POST /api/integrations/sheet-leads
// Shared-secret webhook called by the Google Apps Script bound to a lead
// spreadsheet (Meta lead-ads, Website/SEO form, …). One request = one source +
// one campaign tab's new rows. `source` selects the column mapping & CRM source.
export const POST = withApiHandler(async (req: Request) => {
  const expected = await getSheetLeadsSecret();
  if (!expected) {
    await recordSheetRejection("not_configured");
    throw new HttpError(503, "Sheet leads webhook not configured", "not_configured");
  }
  if (!secretMatches(req.headers.get("x-webhook-secret"), expected)) {
    await recordSheetRejection("invalid_secret");
    throw unauthorized("invalid_secret");
  }

  const { source, campaign, rows } = BodySchema.parse(await req.json().catch(() => null));

  // Heartbeat — the sheet is alive and has nothing new. Recorded, not ingested.
  if (rows.length === 0) {
    await recordSheetContact(
      source,
      { rows: 0, inserted: 0, reInquiries: 0, skipped: 0, errorRows: 0, campaign: campaign ?? null },
      { heartbeat: true },
    );
    return NextResponse.json({ ok: true, heartbeat: true });
  }
  if (!campaign) throw badRequest("campaign is required when rows are sent", "campaign_required");

  const result = await ingestSheetLeads({ sourceKey: source, campaign, rows });
  await recordSheetContact(source, {
    rows: result.received,
    inserted: result.inserted,
    reInquiries: result.reInquiries,
    skipped: result.skippedAlreadyImported + result.skippedAlreadyKnown,
    errorRows: result.errorRows,
    campaign,
  });
  // `duplicatesFlagged` kept as a backward-compatible alias for the Apps Script
  // logger; duplicates are now folded as re-inquiries rather than flagged rows.
  return NextResponse.json({ ...result, duplicatesFlagged: result.reInquiries });
});
