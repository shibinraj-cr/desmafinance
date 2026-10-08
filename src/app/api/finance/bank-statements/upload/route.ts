import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { importUploadedPdf } from "@/lib/bank/engine";
import { BankAutomationError, ERROR_LABEL } from "@/lib/bank/errors";
import { redact } from "@/lib/bank/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Under Vercel's 4.5 MB request cap — a daily or monthly statement is far smaller. */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * POST /api/finance/bank-statements/upload (multipart: file, optional
 * integrationId, optional password) — import one statement PDF now and say
 * what happened: which account it belongs to (read off the PDF, created on
 * first sight), its period, how many transactions were new and how many were
 * already known. One file per request, so the page can report file by file.
 *
 * `password` opens an encrypted PDF for this request only; it is not stored,
 * logged or echoed back.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("manage");
  const form = await req.formData();
  const file = form.get("file");
  const integrationId = String(form.get("integrationId") ?? "") || null;
  const password = String(form.get("password") ?? "") || null;
  if (!(file instanceof File)) throw badRequest("Choose a statement PDF");
  if (file.size > MAX_BYTES) throw badRequest("The PDF must be under 4 MB");
  try {
    const res = await importUploadedPdf(new Uint8Array(await file.arrayBuffer()), userId, { integrationId, password });
    await recordAudit({
      entityType: "BankStatement",
      entityId: res.statementId,
      action: "CREATE",
      userId,
      changes: { upload: true, status: res.status, inserted: res.inserted, duplicates: res.duplicates },
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof BankAutomationError) {
      return NextResponse.json(
        { error: e.code, message: `${ERROR_LABEL[e.code]}${e.message ? ` — ${redact(e.message, [password])}` : ""}` },
        { status: 422 },
      );
    }
    throw e;
  }
});
