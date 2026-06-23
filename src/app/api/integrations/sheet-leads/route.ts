import { NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { withApiHandler } from "@/lib/api";
import { HttpError, unauthorized } from "@/lib/http-error";
import { ingestSheetLeads } from "@/lib/crm-sheet-ingest";
import { getSheetLeadsSecret } from "@/lib/app-settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // node:crypto + Buffer

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const BodySchema = z.object({
  source: z.string().trim().min(1).max(40),
  campaign: z.string().trim().min(1).max(200),
  rows: z.array(z.record(z.unknown())).min(1).max(500),
});

// POST /api/integrations/sheet-leads
// Shared-secret webhook called by the Google Apps Script bound to a lead
// spreadsheet (Meta lead-ads, Website/SEO form, …). One request = one source +
// one campaign tab's new rows. `source` selects the column mapping & CRM source.
export const POST = withApiHandler(async (req: Request) => {
  const expected = await getSheetLeadsSecret();
  if (!expected) throw new HttpError(503, "Sheet leads webhook not configured", "not_configured");
  if (!secretMatches(req.headers.get("x-webhook-secret"), expected)) throw unauthorized("invalid_secret");

  const { source, campaign, rows } = BodySchema.parse(await req.json().catch(() => null));
  const result = await ingestSheetLeads({ sourceKey: source, campaign, rows });
  // `duplicatesFlagged` kept as a backward-compatible alias for the Apps Script
  // logger; duplicates are now folded as re-inquiries rather than flagged rows.
  return NextResponse.json({ ...result, duplicatesFlagged: result.reInquiries });
});
