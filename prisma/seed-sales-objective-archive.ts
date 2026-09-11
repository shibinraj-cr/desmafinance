/**
 * Load the DESMA sales-objective workbook into SalesObjectiveArchive.
 *
 * The figures are NOT checked into this repo — it is public, and these are the
 * company's actual monthly collections. They live in the database instead, and
 * this script is how they get there.
 *
 * SOURCE: "DESMA - Sales Objective Target.xlsx", sheet "Collection ". The
 * layout is one block per quarter: column B carries the quarter label on the
 * block's first row, C the month, D the collection. Everything else on the
 * sheet (quarter totals, 2x targets, the 70% split, the ratio columns) is
 * DERIVED, and the app recomputes all of it from the chain rule — so only
 * column D is read here. A month with no figure is skipped, not stored as zero.
 *
 * WHY BOTH HALVES ARE STORED: months before the finance ledger starts are the
 * only record that exists and are what the page shows. Months from the ledger's
 * first month on are kept as the reconciliation reference — the ledger supplies
 * the displayed figure and this is what it gets checked against.
 *
 * IDEMPOTENT: upserts one row per month key. Safe to re-run after the workbook
 * is updated; a month dropped from the sheet is left in place, not deleted.
 *
 *   npx tsx prisma/seed-sales-objective-archive.ts "path/to/workbook.xlsx"
 *   npx tsx prisma/seed-sales-objective-archive.ts "path/to/workbook.xlsx" --dry
 */
import * as path from "node:path";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SHEET_NAME = "Collection ";
/** 1-based columns on the sheet: B = period, C = month, D = collected. */
const COL_MONTH = "C";
const COL_COLLECTED = "D";

type Row = { monthKey: string; collected: number };

/**
 * Month cells are read as raw Excel serials, NOT as Dates.
 *
 * `cellDates: true` on this workbook turns 1 Apr 2024 into
 * 2024-03-31T18:29:50Z — ten seconds shy of the day, which lands in March
 * whether you read it as UTC or as IST. Every month would shift back one.
 * `SSF.parse_date_code` reads the serial directly and has no such problem.
 */
function monthKeyOf(value: unknown): string | null {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (!d || !d.y || !d.m) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}`;
  }
  if (typeof value === "string") {
    const m = /^(\d{4})-(\d{2})/.exec(value.trim());
    return m ? `${m[1]}-${m[2]}` : null;
  }
  return null;
}

function readWorkbook(file: string): Row[] {
  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[SHEET_NAME] ?? wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error(`No sheet named "${SHEET_NAME}" in ${file}`);
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");

  const rows: Row[] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const monthCell = sheet[`${COL_MONTH}${r + 1}`];
    const amountCell = sheet[`${COL_COLLECTED}${r + 1}`];
    const monthKey = monthKeyOf(monthCell?.v);
    if (!monthKey) continue;
    const collected = typeof amountCell?.v === "number" ? amountCell.v : null;
    // A blank month is a month that hasn't been collected yet, not a zero.
    if (collected === null) continue;
    rows.push({ monthKey, collected });
  }
  return rows;
}

async function main() {
  const file = process.argv[2];
  const dry = process.argv.includes("--dry");
  if (!file) {
    console.error(
      'Usage: npx tsx prisma/seed-sales-objective-archive.ts "DESMA - Sales Objective Target.xlsx" [--dry]',
    );
    process.exit(1);
  }

  const rows = readWorkbook(path.resolve(file));
  if (rows.length === 0) throw new Error("No month rows found — check the sheet layout");

  const first = rows[0].monthKey;
  const last = rows[rows.length - 1].monthKey;
  const total = rows.reduce((s, r) => s + r.collected, 0);
  console.log(`Read ${rows.length} months (${first} → ${last}), totalling ${total.toFixed(2)}`);

  if (dry) {
    for (const r of rows) console.log(`  ${r.monthKey}  ${r.collected.toFixed(2)}`);
    console.log("\n--dry: nothing written.");
    return;
  }

  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const existing = await prisma.salesObjectiveArchive.findUnique({
      where: { monthKey: r.monthKey },
      select: { monthKey: true },
    });
    await prisma.salesObjectiveArchive.upsert({
      where: { monthKey: r.monthKey },
      create: { monthKey: r.monthKey, collected: r.collected },
      update: { collected: r.collected },
    });
    if (existing) updated++;
    else created++;
  }
  console.log(`Done: ${created} created, ${updated} updated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
