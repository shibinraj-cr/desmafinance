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
 *            --rule any|pair  how pre-go-live leads are judged (default any:
 *            any logged action by the cutoff; pair: today's call+note / WhatsApp+stage)
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
  const rule = arg("--rule") ?? "any";
  if (!from || !DAY.test(from) || !DAY.test(to) || from > to || (rule !== "any" && rule !== "pair")) {
    throw new Error("Usage: --from YYYY-MM-DD [--to YYYY-MM-DD] [--out file.csv] [--rule any|pair] [--apply]");
  }

  const r = await backfillLeadReports({ from, to, apply: APPLY, rule, log: (m) => console.log(m) });
  writeFileSync(out, backfillCsv(r.rows));

  const sum = (k: "received" | "contacted" | "missed" | "late") => r.rows.reduce((n, row) => n + row.report.totals[k], 0);
  console.log(APPLY ? "\nAPPLIED" : "\nDRY RUN — nothing written to the database (pass --apply to write)");
  console.log(`${r.from} → ${r.to}: ${r.days} working day(s); tracking began ${r.trackingStart}`);
  console.log(
    r.rule === "any"
      ? "leads assigned before go-live judged by the older rule: any call, note, WhatsApp or stage/Status change by the cutoff"
      : "leads assigned before go-live judged by today's rule: call + note, or WhatsApp + stage/Status change",
  );
  console.log(`rebuilt ${r.rebuilt} assignment(s); ${r.excludedImports} bulk-import carryover left out`);
  console.log(`${r.rows.length} BDE-day report(s): received ${sum("received")}, contacted on time ${sum("contacted")}, missed ${sum("missed")} (${sum("late")} contacted late)`);
  const stored = { none: 0, submitted: 0, generated: 0 };
  for (const row of r.rows) stored[row.existing]++;
  console.log(`before the run: ${stored.submitted} submitted by the BDE, ${stored.generated} already generated, ${stored.none} missing`);

  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  console.log("\nrebuilt assignments due in the range, by kind — received / contacted on time / missed:");
  const kinds = { fresh: "new lead (created within a day)", older: "older lead handed out", reassigned: "taken over from another BDE" };
  for (const [k, label] of Object.entries(kinds)) {
    const b = r.breakdown.byKind[k as keyof typeof kinds];
    console.log(`  ${label.padEnd(34)} ${String(b.received).padStart(5)}  ${String(b.contacted).padStart(5)}  ${String(b.missed).padStart(5)}   on time ${pct(b.contacted, b.contacted + b.missed)}`);
  }
  const why = {
    nothing: "nothing logged by the BDE",
    call_no_note: "call logged, no note",
    stage_only: "stage/Status changed, no WhatsApp or call",
    whatsapp_no_stage: "WhatsApp sent, no stage/Status change",
    note_only: "note added, no call",
    late: r.rule === "any" ? "contacted, but after the cutoff" : "a full pair, but after the cutoff",
  };
  const missedTotal = Object.values(r.breakdown.missed).reduce((a, b) => a + b, 0);
  console.log("\nwhy the misses missed:");
  for (const [k, label] of Object.entries(why)) {
    const n = r.breakdown.missed[k as keyof typeof why];
    console.log(`  ${label.padEnd(42)} ${String(n).padStart(5)}  (${pct(n, missedTotal)})`);
  }
  if (r.applied) console.log("applied:", JSON.stringify(r.applied));
  console.log(`CSV written to ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
