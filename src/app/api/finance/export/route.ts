import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod, periodLabel, rangeFor } from "@/lib/period";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const period = parsePeriod({
    period: searchParams.get("period") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });
  const range = rangeFor(period);

  const rows = await prisma.transaction.findMany({
    where: {
      deletedAt: null,
      ...(range.from || range.to
        ? {
            date: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lt: range.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  // Build a flat sheet that mirrors the original Excel tracker layout.
  let running = 0;
  const data = rows.map((t, i) => {
    const v = Number(t.amount.toString());
    running += t.type === "Revenue" ? v : -v;
    return {
      "Sl No": i + 1,
      Month: t.month,
      Date: t.date.toISOString().slice(0, 10),
      Type: t.type,
      Category: t.category,
      "Sub-Item": t.subItem,
      "Description / Narration": t.description ?? "",
      "Payment Mode": t.paymentMode,
      "Amount (₹)": v,
      Flow: t.flow,
      "Running Balance (₹)": running,
    };
  });

  const ws = XLSX.utils.json_to_sheet(data);
  // Reasonable column widths
  ws["!cols"] = [
    { wch: 6 },
    { wch: 8 },
    { wch: 12 },
    { wch: 10 },
    { wch: 32 },
    { wch: 32 },
    { wch: 32 },
    { wch: 12 },
    { wch: 14 },
    { wch: 9 },
    { wch: 18 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  // Wrap as Uint8Array so it satisfies the WHATWG BodyInit type used by NextResponse.
  const body = new Uint8Array(buf);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `desfin-transactions-${period.kind}-${stamp}.xlsx`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-period-label": periodLabel(period),
    },
  });
}
