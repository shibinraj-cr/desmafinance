/**
 * One-time importer: reads the original DesmaInternational_Expense_Tracker xlsx
 * and bulk-inserts every Daily Tracker row into the database.
 *
 * Usage:
 *   EXCEL_PATH="/absolute/path/to/DesmaInternational_Expense_Tracker.xlsx" \
 *   pnpm db:seed-from-excel
 */
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";

const prisma = new PrismaClient();

const HEADER_ROW = 3; // 1-based; data starts at row 4

type Row = {
  slNo?: number;
  month?: string;
  date?: Date | string | number;
  type?: string;
  category?: string;
  subItem?: string;
  description?: string;
  paymentMode?: string;
  amount?: number;
  flow?: string;
};

function excelDateToJS(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  if (typeof v === "string" && v) {
    const d = new Date(v);
    return isNaN(+d) ? null : d;
  }
  return null;
}

async function main() {
  const candidates = [
    process.env.EXCEL_PATH,
    path.resolve(process.cwd(), "../DesmaInternational_Expense_Tracker 29042026 (2).xlsx"),
    path.resolve(process.cwd(), "../DesmaInternational_Expense_Tracker.xlsx"),
  ].filter(Boolean) as string[];

  const file = candidates.find((p) => p && fs.existsSync(p));
  if (!file) {
    console.error("Could not locate the Excel file. Set EXCEL_PATH to the absolute path of the xlsx.");
    process.exit(1);
  }
  console.log(`Reading ${file}`);

  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets["Daily Tracker"];
  if (!sheet) {
    console.error('Workbook has no "Daily Tracker" sheet.');
    process.exit(1);
  }

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: ["slNo", "month", "date", "type", "category", "subItem", "description", "paymentMode", "amount", "flow"],
    range: HEADER_ROW,
    defval: null,
    raw: true,
  });

  const cleanRows: Row[] = json
    .map((r) => ({
      slNo: typeof r.slNo === "number" ? r.slNo : undefined,
      month: typeof r.month === "string" ? r.month.trim() : undefined,
      date: r.date as Date | string | number | undefined,
      type: typeof r.type === "string" ? r.type.trim() : undefined,
      category: typeof r.category === "string" ? r.category.trim() : undefined,
      subItem: typeof r.subItem === "string" ? r.subItem.trim() : undefined,
      description: typeof r.description === "string" ? r.description.trim() : undefined,
      paymentMode: typeof r.paymentMode === "string" ? r.paymentMode.trim() : undefined,
      amount: typeof r.amount === "number" ? r.amount : undefined,
      flow: typeof r.flow === "string" ? r.flow.trim() : undefined,
    }))
    .filter((r) => r.type && r.category && r.amount && r.amount > 0);

  console.log(`Parsed ${cleanRows.length} rows. Wiping existing transactions and re-importing…`);
  await prisma.transaction.deleteMany({});

  let inserted = 0;
  const chunk = 200;
  for (let i = 0; i < cleanRows.length; i += chunk) {
    const slice = cleanRows.slice(i, i + chunk);
    const data = slice
      .map((r) => {
        const date = excelDateToJS(r.date);
        if (!date) return null;
        return {
          date,
          month: r.month ?? "",
          type: r.type ?? "",
          category: r.category ?? "",
          subItem: r.subItem ?? "",
          description: r.description ?? null,
          paymentMode: r.paymentMode ?? "",
          amount: r.amount ?? 0,
          flow: r.flow ?? (r.type === "Revenue" ? "Inflow" : "Outflow"),
        };
      })
      .filter(Boolean) as Array<{
        date: Date;
        month: string;
        type: string;
        category: string;
        subItem: string;
        description: string | null;
        paymentMode: string;
        amount: number;
        flow: string;
      }>;
    const res = await prisma.transaction.createMany({ data });
    inserted += res.count;
  }
  console.log(`✓ Imported ${inserted} transactions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
