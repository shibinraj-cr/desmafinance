/**
 * One-off backfill — the daily lead report for days before tracking began.
 *
 * Rebuilds every lead assignment from the activity ledger, judges each against
 * its cutoff with today's contact rule, and builds every BDE's report for every
 * working day in the range. A report a BDE submitted before keeps its
 * narrative and activity numbers; it only gains the lead report. See
 * backfillLeadReports in src/lib/crm-lead-report-backfill.ts.
 *
 * DRY RUN by default — computes everything, writes a CSV (one line per BDE per
 * day) and nothing to the database. Pass `--apply` to write. Safe to re-run:
 * assignments are keyed, and reports are updated in place.
 *
 *   npx tsx prisma/backfill-lead-report.ts --from 2026-10-01                 # dry run
 *   npx tsx prisma/backfill-lead-report.ts --from 2026-10-01 --apply         # write
 *   options: --to YYYY-MM-DD (default yesterday, IST)  --out <file.csv>
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { addDays, todayIst } from "../src/lib/lead-pulse-dates";
import { backfillCsv, backfillLeadReports } from "../src/lib/crm-lead-report-backfill";

const APPLY = process.argv.includes("--apply");
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  const from = arg("--from");
  const to = arg("--to") ?? addDays(todayIst(), -1);
  const out = arg("--out") ?? "lead-report-backfill.csv";
  if (!from || !DAY.test(from) || !DAY.test(to) || from > to) {
    throw new Error("Usage: --from YYYY-MM-DD [--to YYYY-MM-DD] [--out file.csv] [--apply]");
  }

  const r = await backfillLeadReports({ from, to, apply: APPLY, log: (m) => console.log(m) });
  writeFileSync(out, backfillCsv(r.rows));

  const sum = (k: "received" | "contacted" | "missed" | "late") => r.rows.reduce((n, row) => n + row.report.totals[k], 0);
  console.log(APPLY ? "\nAPPLIED" : "\nDRY RUN — nothing written to the database (pass --apply to write)");
  console.log(`${r.from} → ${r.to}: ${r.days} working day(s); tracking began ${r.trackingStart}`);
  console.log(`rebuilt ${r.rebuilt} assignment(s); ${r.excludedImports} bulk-import carryover left out`);
  console.log(`${r.rows.length} BDE-day report(s): received ${sum("received")}, contacted on time ${sum("contacted")}, missed ${sum("missed")} (${sum("late")} contacted late)`);
  const stored = { none: 0, submitted: 0, generated: 0 };
  for (const row of r.rows) stored[row.existing]++;
  console.log(`before the run: ${stored.submitted} submitted by the BDE, ${stored.generated} already generated, ${stored.none} missing`);
  if (r.applied) console.log("applied:", JSON.stringify(r.applied));
  console.log(`CSV written to ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
