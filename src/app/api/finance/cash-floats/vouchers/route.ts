import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { CASH_PAGE, importVouchers, requireFloat } from "@/lib/cash-floats-data";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * POST /api/finance/cash-floats/vouchers (multipart: file) — the director's
 * Outdoor Marketing vouchers from Excel. Nothing is imported if any row is
 * unreadable; a voucher already uploaded is skipped.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId } = await requireFloat(CASH_PAGE, "act");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose the voucher Excel file");
  if (file.size > MAX_BYTES) throw badRequest("The file must be under 2 MB");
  const res = await importVouchers(new Uint8Array(await file.arrayBuffer()), userId);
  return NextResponse.json(res, { status: res.problems.length ? 422 : 200 });
});
