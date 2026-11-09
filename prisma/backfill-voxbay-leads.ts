/**
 * One-off backfill — leads for Voxbay calls filed before incoming calls
 * created them.
 *
 * Until this change the call-record webhook filed a call from an unknown number
 * without a lead (VoxbayCall.leadUnmatched = true). This gives each such number
 * what a live call now gets: a Voxbay-source lead (or the lead that has appeared
 * for it since), assigned to the BDE who answered when exactly one did, with
 * its calls on the lead's Timeline. Numbers we only dialled out to are left
 * alone. See backfillVoxbayLeads in src/lib/voxbay-webhook-ingest.ts.
 *
 * DRY RUN by default — prints what it would do and writes nothing. Pass
 * `--apply` to perform the writes. Safe to re-run: a number done once has no
 * unlinked calls left.
 *
 *   npx tsx prisma/backfill-voxbay-leads.ts            # dry run
 *   npx tsx prisma/backfill-voxbay-leads.ts --apply    # write
 */
import { prisma } from "../src/lib/prisma";
import { backfillVoxbayLeads } from "../src/lib/voxbay-webhook-ingest";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await backfillVoxbayLeads(APPLY);
  const create = rows.filter((r) => r.action === "create");
  console.log(APPLY ? "APPLIED" : "DRY RUN — nothing written (pass --apply to write)");
  console.log(
    `${rows.length} number(s) with unlinked calls: ${create.length} new lead(s), ` +
      `${rows.length - create.length} linked to an existing lead, ` +
      `${create.filter((r) => r.assignTo).length} assigned to the BDE who answered, ` +
      `${rows.reduce((n, r) => n + r.calls, 0)} call(s) filed.`,
  );
  for (const r of rows) {
    console.log(`  ${r.phone}  ${r.calls} call(s)  ${r.action === "create" ? "new lead" : "existing lead"}  ${r.assignTo ? `→ ${r.assignTo}` : r.action === "create" ? "(unassigned)" : ""}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
