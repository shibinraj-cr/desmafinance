import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { conflict } from "@/lib/http-error";
import { todayIst } from "@/lib/lead-pulse-dates";
import { requireBank } from "@/lib/bank/access";
import { createRun } from "@/lib/bank/engine";
import { continueInBackground } from "@/lib/bank/kick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const Schema = z
  .object({ integrationId: z.string().min(1), from: z.string().regex(ISO), to: z.string().regex(ISO) })
  .refine((b) => b.from <= b.to, "From must be on or before To")
  .refine((b) => b.to <= todayIst(), "To cannot be in the future")
  .refine((b) => (Date.parse(b.to) - Date.parse(b.from)) / 86_400_000 <= 366, "At most one year per backfill");

/**
 * POST /api/finance/bank-automation/backfill — import every statement e-mail
 * covering [from, to], oldest first. Idempotent: statements already imported
 * are skipped by Gmail message id, re-sent PDFs by file hash, and any row
 * already present by transaction hash — running the same backfill twice adds
 * nothing the second time. Never started automatically.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const body = Schema.parse(await req.json());
  const { runId, existing } = await createRun({
    integrationId: body.integrationId,
    trigger: "BACKFILL",
    userId,
    fromDate: body.from,
    toDate: body.to,
  });
  if (existing) throw conflict("Another run is in progress — wait for it to finish, then start the backfill");
  continueInBackground(runId);
  return NextResponse.json({ runId }, { status: 202 });
});
