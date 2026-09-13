/**
 * One-time import of a personal investments workbook into the Personal Wealth
 * desk.
 *
 * Everything about the data stays on your machine: the file path comes from an
 * environment variable, nothing is committed, and this script contains no
 * figures, names or classifications of its own. That matters — this repository
 * is public.
 *
 * Usage (dry run — prints what it would write and changes nothing):
 *
 *   WEALTH_XLSX="/path/to/workbook.xlsx" \
 *   WEALTH_OWNER_EMAIL="you@example.com" \
 *   npm run wealth:import
 *
 * Add --yes to actually write:
 *
 *   ... npm run wealth:import -- --yes
 *
 * It is idempotent on name: re-running updates the holding of the same name
 * rather than creating a second one, so you can correct the sheet and re-import.
 *
 * What it cannot know: which asset class each row belongs to. The guess below
 * reads product and institution words only ("ULIP", "mutual fund", "bank"), and
 * anything it cannot place lands in "Uncategorised" for you to fix in two
 * clicks on the page. That is deliberate — a cleverer guess would need the
 * names in this file.
 */
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";
import { toPrismaDate } from "../src/lib/lead-pulse-dates";
import {
  parseGold,
  parseHoldings,
  parseLiabilities,
  readSheet,
} from "../src/lib/wealth-import";

const prisma = new PrismaClient();

const DRY = !process.argv.includes("--yes");
const FILE = process.env.WEALTH_XLSX;
const OWNER_EMAIL = process.env.WEALTH_OWNER_EMAIL;
const OWNER_USERNAME = process.env.WEALTH_OWNER_USERNAME;

const MONEY_SHEET = process.env.WEALTH_SHEET_MONEY ?? "Money Invested";
const GOLD_SHEET = process.env.WEALTH_SHEET_GOLD ?? "Gold";

// ── run ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!FILE) throw new Error("Set WEALTH_XLSX to the workbook path.");
  if (!OWNER_EMAIL && !OWNER_USERNAME) {
    throw new Error("Set WEALTH_OWNER_EMAIL (or WEALTH_OWNER_USERNAME) to the account that owns this desk.");
  }

  const owner = await prisma.user.findFirst({
    where: OWNER_EMAIL ? { email: OWNER_EMAIL } : { username: OWNER_USERNAME! },
    select: { id: true, username: true },
  });
  if (!owner) throw new Error(`No user matches ${OWNER_EMAIL ?? OWNER_USERNAME}.`);

  const wb = XLSX.readFile(FILE, { cellDates: true });
  const holdings = parseHoldings(readSheet(wb, MONEY_SHEET));
  const { items: goldItems, ratePerGram } = parseGold(wb, GOLD_SHEET);
  const liabilities = parseLiabilities(wb, MONEY_SHEET);

  const totalValue = holdings.reduce((s, h) => s + (h.value ?? 0), 0);
  const totalGrams = goldItems.reduce((s, g) => s + g.grams, 0);
  const totalOwed = liabilities.reduce((s, l) => s + l.outstanding, 0);

  console.log(`\nOwner            ${owner.username}`);
  console.log(`Workbook         ${FILE}`);
  console.log(`\nHoldings         ${holdings.length}  (value ${fmt(totalValue)})`);
  const byClass = new Map<string, number>();
  for (const h of holdings) byClass.set(h.assetClass, (byClass.get(h.assetClass) ?? 0) + 1);
  for (const [k, n] of [...byClass].sort()) console.log(`  ${k.padEnd(12)} ${n}`);
  const unplaced = holdings.filter((h) => h.assetClass === "other").length;
  if (unplaced > 0) {
    console.log(`  → ${unplaced} row(s) could not be classified from the sheet; set them on the page.`);
  }
  const noValue = holdings.filter((h) => h.value === null).length;
  if (noValue > 0) console.log(`  → ${noValue} row(s) carry no value and will import at zero.`);

  console.log(`\nGold             ${goldItems.length} pieces, ${totalGrams} g`);
  console.log(`Gold rate        ${ratePerGram ? `₹${ratePerGram}/g` : "not found in the sheet — set it on the page"}`);
  console.log(`Liabilities      ${liabilities.length}  (owed ${fmt(totalOwed)})`);
  for (const l of liabilities) console.log(`  ${l.name.padEnd(16)} ${fmt(l.outstanding)}`);
  console.log(
    `\nNet worth        ${fmt(totalValue + totalGrams * (ratePerGram ?? 0) - totalOwed)}  (check this against the sheet before writing)`,
  );

  if (DRY) {
    console.log("\nDRY RUN — nothing written. Re-run with --yes to import.\n");
    return;
  }

  let created = 0;
  let updated = 0;

  for (const h of holdings) {
    const existing = await prisma.wealthHolding.findFirst({
      where: { ownerUserId: owner.id, name: h.name },
      select: { id: true },
    });
    const data = {
      assetClass: h.assetClass,
      institution: h.institution,
      policyNo: h.policyNo,
      contributionAmount: h.contributionAmount,
      frequency: h.frequency,
      dueDayOfMonth: h.dueDayOfMonth,
      renewalOn: h.renewalOn ? toPrismaDate(h.renewalOn) : null,
      termYears: h.termYears,
      sumAssured: h.sumAssured,
      portalUrl: h.portalUrl,
    };
    const id = existing
      ? (await prisma.wealthHolding.update({ where: { id: existing.id }, data, select: { id: true } })).id
      : (
          await prisma.wealthHolding.create({
            data: { ownerUserId: owner.id, name: h.name, ...data },
            select: { id: true },
          })
        ).id;
    existing ? updated++ : created++;

    if (h.value !== null) {
      const asOn = toPrismaDate(h.valuedOn ?? new Date().toISOString().slice(0, 10));
      await prisma.wealthValuation.upsert({
        where: { holdingId_asOn: { holdingId: id, asOn } },
        create: { holdingId: id, asOn, value: h.value, source: "import" },
        update: { value: h.value, source: "import" },
      });
    }
  }

  for (const g of goldItems) {
    const existing = await prisma.wealthGoldItem.findFirst({
      where: { ownerUserId: owner.id, category: g.category, name: g.name },
      select: { id: true },
    });
    if (existing) {
      await prisma.wealthGoldItem.update({
        where: { id: existing.id },
        data: { grams: g.grams, dueOn: g.dueOn ? toPrismaDate(g.dueOn) : null, archivedAt: null },
      });
    } else {
      await prisma.wealthGoldItem.create({
        data: {
          ownerUserId: owner.id,
          category: g.category,
          name: g.name,
          grams: g.grams,
          dueOn: g.dueOn ? toPrismaDate(g.dueOn) : null,
        },
      });
    }
  }

  for (const l of liabilities) {
    const existing = await prisma.wealthLiability.findFirst({
      where: { ownerUserId: owner.id, name: l.name },
      select: { id: true },
    });
    if (existing) {
      await prisma.wealthLiability.update({
        where: { id: existing.id },
        data: { kind: l.kind, outstanding: l.outstanding },
      });
    } else {
      await prisma.wealthLiability.create({
        data: { ownerUserId: owner.id, name: l.name, kind: l.kind, outstanding: l.outstanding },
      });
    }
  }

  if (ratePerGram) {
    await prisma.wealthSetting.upsert({
      where: { ownerUserId: owner.id },
      create: { ownerUserId: owner.id, goldRatePerGram: ratePerGram },
      update: { goldRatePerGram: ratePerGram },
    });
  }

  console.log(`\nImported. Holdings created ${created}, updated ${updated}.`);
  console.log("Open /executive/wealth — anything in Uncategorised needs a class.\n");
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

main()
  .catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
