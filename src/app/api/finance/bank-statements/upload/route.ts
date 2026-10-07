import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { badRequest, conflict } from "@/lib/http-error";
import { requireBank } from "@/lib/bank/access";
import { ingestUploadedPdf } from "@/lib/bank/engine";
import { continueInBackground } from "@/lib/bank/kick";
import { BankAutomationError } from "@/lib/bank/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Under Vercel's 4.5 MB request cap — a daily or monthly statement is far smaller. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST /api/finance/bank-statements/upload (multipart: integrationId, file) —
 * import a statement PDF by hand: when the e-mailed link expired, the bank
 * page changed, or for statements from before the automation existed. Goes
 * through the same archive → parse → validate → dedupe pipeline.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const form = await req.formData();
  const integrationId = String(form.get("integrationId") ?? "");
  const file = form.get("file");
  if (!integrationId || !(file instanceof File)) throw badRequest("integrationId and a PDF file are required");
  if (file.size > MAX_BYTES) throw badRequest("The PDF must be under 4 MB");
  try {
    const res = await ingestUploadedPdf(integrationId, new Uint8Array(await file.arrayBuffer()), userId);
    if (res.duplicate) throw conflict("This exact PDF has already been imported", "duplicate_statement");
    if (res.runId) continueInBackground(res.runId);
    return NextResponse.json(res, { status: 202 });
  } catch (e) {
    if (e instanceof BankAutomationError && e.code === "PDF_INVALID") throw badRequest(e.message, "pdf_invalid");
    throw e;
  }
});
