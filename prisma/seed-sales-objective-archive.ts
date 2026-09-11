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
 * SCOPE: only months BEFORE the finance ledger starts (LEDGER_FROM) are loaded.
 * From that month on DesGro is the record, and the page reads Transaction rows
 * directly — storing the workbook's figures for those months would just be a
 * second, staler copy of what the ledger already knows.
 *
 * --with-reference additionally loads the overlap months as a reconciliation
 * reference: the ledger still supplies the displayed figure, but the page then
 * shows a "vs sheet" column and flags any month that has drifted. Use it when
 * you want to audit the ledger against the workbook; leave it off otherwise.
 *
 * IDEMPOTENT: upserts one row per month key. Safe to re-run after the workbook
 * is updated; a month dropped from the sheet is left in place, not deleted.
 *
 * --prune removes rows from LEDGER_FROM on, for a database that was loaded
 * before the scope narrowed. Reported on every write run, deleted only when
 * asked — this never drops a row you didn't say to drop.
 *
 *   npx tsx prisma/seed-sales-objective-archive.ts "path/to/workbook.xlsx"
 *   npx tsx prisma/seed-sales-objective-archive.ts "path/to/workbook.xlsx" --dry
 *   npx tsx prisma/seed-sales-objective-archive.ts "path/to/workbook.xlsx" --with-reference
 *   npx tsx prisma/seed-sales-objective-archive.ts "path/to/workbook.xlsx" --prune
 */
// Prisma Client reads process.env and does NOT load .env itself, so a bare
// `npx tsx prisma/seed-...` would die on a missing DATABASE_URL. Same fix the
// other env-driven script in here uses (grant-marketing-admin-bde-enrollment).
import "dotenv/config";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { LEDGER_FROM } from "../src/lib/sales-objective";

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
  const withReference = process.argv.includes("--with-reference");
  const prune = process.argv.includes("--prune");
  if (!file) {
    console.error(
      'Usage: npx tsx prisma/seed-sales-objective-archive.ts "DESMA - Sales Objective Target.xlsx" [--dry]',
    );
    process.exit(1);
  }

  // Reading the workbook needs no database, so only guard the write path —
  // --dry stays usable anywhere, including a checkout with no .env.
  if (!dry && !process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Run this from a checkout whose .env has it, or\n" +
        "pass it inline:  DATABASE_URL=... npx tsx prisma/seed-sales-objective-archive.ts <file>",
    );
    process.exit(1);
  }

  const all = readWorkbook(path.resolve(file));
  if (all.length === 0) throw new Error("No month rows found — check the sheet layout");

  // Everything from LEDGER_FROM on is DesGro's to answer for. Say what is being
  // left behind rather than quietly dropping it.
  const rows = withReference ? all : all.filter((r) => r.monthKey < LEDGER_FROM);
  const skipped = all.length - rows.length;
  if (rows.length === 0) {
    throw new Error(`Every month in the workbook is ${LEDGER_FROM} or later — nothing to archive`);
  }

  const first = rows[0].monthKey;
  const last = rows[rows.length - 1].monthKey;
  const total = rows.reduce((s, r) => s + r.collected, 0);
  console.log(
    `Read ${all.length} months from the workbook; loading ${rows.length} ` +
      `(${first} → ${last}), totalling ${total.toFixed(2)}`,
  );
  if (skipped > 0) {
    console.log(
      `Skipping ${skipped} month${skipped === 1 ? "" : "s"} from ${LEDGER_FROM} on — ` +
        "DesGro's ledger is the record for those. Pass --with-reference to load them " +
        "anyway as a reconciliation reference.",
    );
  }

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

  // A database seeded before the scope narrowed still carries the ledger-band
  // months. They are harmless — the ledger wins on every month it covers — but
  // they do switch the "vs sheet" reconciliation column on, so say they're there.
  if (!withReference) {
    const stale = await prisma.salesObjectiveArchive.findMany({
      where: { monthKey: { gte: LEDGER_FROM } },
      select: { monthKey: true },
      orderBy: { monthKey: "asc" },
    });
    if (stale.length > 0) {
      const span = `${stale[0].monthKey} → ${stale[stale.length - 1].monthKey}`;
      if (prune) {
        await prisma.salesObjectiveArchive.deleteMany({
          where: { monthKey: { gte: LEDGER_FROM } },
        });
        console.log(`Pruned ${stale.length} out-of-scope row(s) (${span}).`);
      } else {
        console.log(
          `\nNote: ${stale.length} row(s) from ${LEDGER_FROM} on are still stored (${span}).\n` +
            "DesGro's ledger is the record for those months, so the page ignores them for the\n" +
            "figure — but their presence turns the \"vs sheet\" reconciliation column on.\n" +
            "Re-run with --prune to remove them, or --with-reference to keep them deliberately.",
        );
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
