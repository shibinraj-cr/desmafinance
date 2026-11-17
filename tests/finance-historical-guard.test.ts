/**
 * Guard: every read of the Transaction ledger must leave out payments from
 * before DesGro (`isHistorical`), unless it is listed below with a reason.
 *
 * Those rows exist only so a candidate's paid amount and balance are right.
 * The finance pages default to "All time", so a single report that forgot
 * the filter would quietly add years of partial, hand-typed revenue to this
 * year's numbers. This test fails the build when a new query is added
 * without deciding.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/** Reads that deliberately include historical rows: file → [count, reason]. */
const INCLUDES_HISTORICAL: Record<string, [number, string]> = {
  "src/app/(app)/master-data/parties/[id]/page.tsx": [
    1,
    "the candidate's own ledger: old payments are what its balance needs",
  ],
  "src/app/(app)/master-data/services/page.tsx": [1, "usage count that gates deleting a service"],
  "src/app/(app)/master-data/categories/page.tsx": [1, "usage count that gates deleting a category"],
  "src/app/api/master/categories/[id]/route.ts": [1, "refuses to delete a category still in use"],
  "src/app/api/master/sub-categories/[id]/route.ts": [1, "refuses to delete a sub-item still in use"],
  "src/app/api/finance/bank-transactions/[id]/reconcile/route.ts": [
    1,
    "checks the picked ids exist; the candidate list it picks from is filtered",
  ],
};

/** `where` builders that already apply the filter themselves. */
const FILTERING_HELPERS = ["activeWhere("];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Text of the call's argument list, from its "(" to the matching ")". */
function callArgs(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(openParen, i + 1);
  }
  return src.slice(openParen);
}

// Not preceded by a quote: ceo-dashboard labels its queries with strings like
// "transaction.aggregate(currentMonthRevenue)".
const READ = /(?<!["'`\w])transaction\s*\.\s*(findMany|aggregate|groupBy|count|findFirst)\s*\(/g;

describe("ledger reads leave out payments from before DesGro", () => {
  const files = walk(SRC);
  const unfiltered = new Map<string, number>();

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(READ)) {
      const args = callArgs(src, m.index! + m[0].length - 1);
      const filtered =
        args.includes("isHistorical") || FILTERING_HELPERS.some((h) => args.includes(h));
      if (!filtered) {
        const rel = relative(ROOT, file);
        unfiltered.set(rel, (unfiltered.get(rel) ?? 0) + 1);
      }
    }
  }

  it("finds the ledger reads it is meant to police", () => {
    // If this drops to zero the regex broke, and the guard below proves nothing.
    const total = files
      .map((f) => [...readFileSync(f, "utf8").matchAll(READ)].length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(30);
  });

  it("every unfiltered read is a listed, deliberate exception", () => {
    const unexpected = [...unfiltered.entries()]
      .filter(([file, n]) => (INCLUDES_HISTORICAL[file]?.[0] ?? 0) < n)
      .map(([file, n]) => `${file} (${n} unfiltered)`);
    expect(
      unexpected,
      "Add `isHistorical: false` to these Transaction reads, or list them in INCLUDES_HISTORICAL with a reason",
    ).toEqual([]);
  });

  it("the listed exceptions are still real (no stale entries)", () => {
    const stale = Object.keys(INCLUDES_HISTORICAL).filter((f) => !unfiltered.has(f));
    expect(stale).toEqual([]);
  });

  it("the shared dashboard filter excludes them", () => {
    const agg = readFileSync(join(SRC, "lib/aggregations.ts"), "utf8");
    const body = agg.slice(agg.indexOf("function activeWhere("));
    expect(body.slice(0, body.indexOf("\n}\n"))).toContain("isHistorical: false");
  });

  it("no raw SQL reads the ledger without the filter", () => {
    const raw = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /(FROM|JOIN)\s+"Transaction"/.test(src) && !src.includes("isHistorical");
    });
    expect(raw.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
