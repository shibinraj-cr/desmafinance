import * as XLSX from "xlsx";
import { withApiHandler } from "@/lib/api";
import { CASH_PAGE, requireFloat } from "@/lib/cash-floats-data";
import { VOUCHER_HEADERS } from "@/lib/cash-floats-vouchers";

export const dynamic = "force-dynamic";

/** GET /api/finance/cash-floats/voucher-template — the Excel layout the voucher upload reads. */
export const GET = withApiHandler(async () => {
  await requireFloat(CASH_PAGE, "view");
  const ws = XLSX.utils.aoa_to_sheet([[...VOUCHER_HEADERS], ["01/11/2026", "OM-001", "Example printer", "Banner printing", 2500]]);
  ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 36 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vouchers");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="outdoor-marketing-vouchers.xlsx"',
    },
  });
});
