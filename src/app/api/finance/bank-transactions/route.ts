import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { TXN_SELECT, listTransactions, parseTxnFilters, serializeTxn, txnWhere } from "@/lib/bank/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXPORT_CAP = 20_000;

/**
 * GET /api/finance/bank-transactions — filtered, paginated bank lines.
 * `?format=csv|xlsx` exports every matching row (capped at 20k) with the
 * same filters the page uses; exports are audited.
 */
export const GET = withApiHandler(async (req: Request) => {
  const { userId } = await requireBank("view");
  const sp = new URL(req.url).searchParams;
  const filters = parseTxnFilters(sp);
  const format = sp.get("format");

  if (format !== "csv" && format !== "xlsx") {
    const page = Math.max(1, Number(sp.get("page")) || 1);
    return NextResponse.json({ page, ...(await listTransactions(filters, page)) });
  }

  const rows = (
    await prisma.bankTransaction.findMany({
      where: txnWhere(filters),
      select: TXN_SELECT,
      orderBy: [{ txnDate: "asc" }, { rowIndex: "asc" }],
      take: EXPORT_CAP,
    })
  ).map(serializeTxn);
  const table = rows.map((r) => ({
    Date: r.txnDate,
    "Value Date": r.valueDate ?? "",
    Description: r.description,
    Reference: r.reference ?? "",
    Type: r.type,
    Debit: r.debit || "",
    Credit: r.credit || "",
    Balance: r.balance ?? "",
    Account: r.account,
    "Statement Date": r.statementDate ?? "",
    "Reconciliation Status": r.recon,
    "DESGRO Transaction ID": r.id,
    "Transaction Hash": r.hash,
  }));
  await recordAudit({ entityType: "BankTransaction", entityId: "export", action: "UPDATE", userId, changes: { export: format, rows: rows.length } });
  const sheet = XLSX.utils.json_to_sheet(table);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    return new Response(XLSX.utils.sheet_to_csv(sheet), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="bank-transactions-${stamp}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Bank Transactions");
  const buf = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="bank-transactions-${stamp}.xlsx"`,
      "cache-control": "private, no-store",
    },
  });
});
