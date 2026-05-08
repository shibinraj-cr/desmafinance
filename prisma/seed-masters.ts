/**
 * Seed Category + SubCategory tables from the static catalog.ts. Idempotent.
 *
 * The current catalog has a few categories that exist for both Revenue and
 * Expense (e.g. "Commissions"). We collapse those into a single Category row
 * with type='Both' and merge their sub-items so the master is clean.
 *
 * Usage:  npm run db:seed-masters
 */
import { PrismaClient } from "@prisma/client";
import {
  REVENUE_CATEGORIES,
  EXPENSE_CATEGORIES,
} from "../src/lib/catalog";

// Inline the sub-item dictionaries from src/lib/catalog.ts so this script
// doesn't depend on internal exports that might change shape.
import * as catalog from "../src/lib/catalog";

const prisma = new PrismaClient();

type SubMap = Record<string, string[]>;

function getSubMaps(): { revenue: SubMap; expense: SubMap } {
  // The catalog module keeps the maps internal — re-derive from the public
  // helpers it exports.
  const rev: SubMap = {};
  for (const c of REVENUE_CATEGORIES) {
    rev[c] = catalog.subItemsFor("Revenue", c);
  }
  const exp: SubMap = {};
  for (const c of EXPENSE_CATEGORIES) {
    exp[c] = catalog.subItemsFor("Expense", c);
  }
  return { revenue: rev, expense: exp };
}

async function main() {
  const { revenue, expense } = getSubMaps();

  // Merge: figure out which category names appear in both lists.
  const allNames = new Set<string>([
    ...REVENUE_CATEGORIES,
    ...EXPENSE_CATEGORIES,
  ]);

  type Plan = { name: string; type: "Revenue" | "Expense" | "Both"; subItems: string[] };
  const plan: Plan[] = [];

  for (const name of allNames) {
    const inR = name in revenue;
    const inE = name in expense;
    const subs = new Set<string>();
    if (inR) for (const s of revenue[name]) subs.add(s);
    if (inE) for (const s of expense[name]) subs.add(s);
    plan.push({
      name,
      type: inR && inE ? "Both" : inR ? "Revenue" : "Expense",
      subItems: Array.from(subs),
    });
  }

  console.log(`Seeding ${plan.length} categories…`);
  for (const p of plan) {
    // Match by (name, type) — that's the unique constraint. If a previous
    // seed wrote it as Revenue/Expense and we've now decided it's Both, we
    // upsert a Both row and leave any other rows alone — admins can clean
    // them up via the UI.
    const cat = await prisma.category.upsert({
      where: { name_type: { name: p.name, type: p.type } },
      update: { isActive: true },
      create: { name: p.name, type: p.type, isActive: true, isSystem: false },
    });
    let added = 0;
    for (const subRaw of p.subItems) {
      // Strip ` (Sales)` / ` (Collection)` suffix if present — the parent
      // category already conveys side, so the suffix is redundant.
      const sub = subRaw.replace(/\s*\((Sales|Collection)\)\s*$/, "").trim();
      const existing = await prisma.subCategory.findUnique({
        where: { categoryId_name: { categoryId: cat.id, name: sub } },
      });
      if (!existing) {
        await prisma.subCategory.create({
          data: { categoryId: cat.id, name: sub, isActive: true, isSystem: false },
        });
        added++;
      }
    }
    console.log(`  ✓ ${p.name} (${p.type}): ${p.subItems.length} sub-items, +${added} new`);
  }

  const totals = {
    categories: await prisma.category.count(),
    subItems: await prisma.subCategory.count(),
    parties: await prisma.party.count(),
  };
  console.log("\nTotals:", totals);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
