/**
 * Seed v2 — updated salary structures per the May 2026 sheet supplied
 * by HR. Differences vs v1:
 *
 *   Allowance split (% of Basic)   v1     v2
 *     HRA                          50     40
 *     Conveyance                   25     20
 *     Medical                      35     25
 *     Special                      40     15
 *     Total allowances            150    100
 *     Gross multiplier             2.5    2
 *
 *   ESI Employer rate              3.25%  3.75%
 *   (handled in hr-salary-engine.ts)
 *
 * Per-employee values pulled directly from the sheet (Basic + ESI
 * applicability + PT slab). Suhaina is ESI-applicable even though her
 * gross is ₹22,500 — the contribution-period continuation rule.
 * Vishnu / Greeshma / Athira are NOT ESI-applicable (gross > 21k and
 * never enrolled).
 *
 * Idempotent — upserts the (employeeId, effectiveFrom=2026-01-01) row.
 * Usage: npm run db:seed-salary-structures-v2
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EFFECTIVE_FROM = new Date(Date.UTC(2026, 0, 1)); // 2026-01-01

type Entry = {
  /// Token used to fuzzy-match the master Employee.name.
  matchKey: string;
  basic: number;
  esi: boolean;
  pt: number;
};

const STRUCTURES: Entry[] = [
  { matchKey: "Aswathi K B", basic: 7250, esi: true, pt: 125 },
  { matchKey: "Sreelakshmi K P", basic: 6500, esi: true, pt: 125 },
  { matchKey: "Suhaina K I", basic: 11250, esi: true, pt: 208 },
  { matchKey: "Vishnu Raj C R", basic: 21000, esi: false, pt: 208 },
  { matchKey: "Greeshma K X", basic: 13375, esi: false, pt: 208 },
  { matchKey: "Soumya B", basic: 10125, esi: true, pt: 167 },
  { matchKey: "Sivapriya Sivakumar", basic: 6500, esi: true, pt: 125 },
  { matchKey: "Vidya Mol A V", basic: 6875, esi: true, pt: 125 },
  { matchKey: "Athira Suresh", basic: 15125, esi: false, pt: 208 },
  { matchKey: "Shency Peter", basic: 9500, esi: true, pt: 167 },
  { matchKey: "Gangapriya P", basic: 6562.5, esi: true, pt: 125 },
  { matchKey: "Hissana Nesrin V H", basic: 5312.5, esi: true, pt: 125 },
  { matchKey: "Divya Shaji", basic: 5062.5, esi: true, pt: 125 },
  { matchKey: "Riswana K Mujeeb", basic: 5712.5, esi: true, pt: 125 },
  { matchKey: "Aparna Surendran", basic: 6250, esi: true, pt: 125 },
  { matchKey: "Vijayalakshmi T N", basic: 5062.5, esi: true, pt: 125 },
  { matchKey: "Sreeshma S", basic: 10000, esi: true, pt: 167 },
];

function nameTokens(s: string): string[] {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[.,()]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

function fuzzyMatch(key: string, candidates: { id: string; name: string }[]): { id: string; name: string } | null {
  const aTokens = nameTokens(key);
  if (aTokens.length === 0) return null;
  const aFirst = aTokens[0];
  let best: { id: string; name: string; score: number } | null = null;
  for (const c of candidates) {
    const bTokens = nameTokens(c.name);
    if (bTokens.length === 0) continue;
    const bFirst = bTokens[0];
    let score = 0;
    if (aFirst === bFirst) score = 1;
    else if (aFirst.length >= 4 && bFirst.length >= 4 && (bFirst.startsWith(aFirst) || aFirst.startsWith(bFirst)))
      score = 0.9;
    else {
      const aSet = new Set(aTokens);
      const bSet = new Set(bTokens);
      let overlap = 0;
      for (const t of aSet) if (bSet.has(t)) overlap++;
      if (overlap > 0) score = overlap / Math.min(aSet.size, bSet.size);
    }
    if (score >= 0.5 && (!best || score > best.score)) {
      best = { id: c.id, name: c.name, score };
    }
  }
  return best;
}

async function main() {
  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true, empCode: true, name: true },
  });
  console.log(`Master: ${employees.length} active employees\n`);

  let upserted = 0;
  const unmatched: string[] = [];
  for (const s of STRUCTURES) {
    const match = fuzzyMatch(s.matchKey, employees);
    if (!match) {
      unmatched.push(s.matchKey);
      continue;
    }
    const gross = s.basic * 2; // 100% allowances + 100% basic
    await prisma.hrSalaryStructure.upsert({
      where: {
        employeeId_effectiveFrom: { employeeId: match.id, effectiveFrom: EFFECTIVE_FROM },
      },
      update: {
        basic: s.basic,
        hraPct: 40,
        conveyancePct: 20,
        medicalPct: 25,
        specialPct: 15,
        esiApplicable: s.esi,
        pfApplicable: true,
        professionalTax: s.pt,
        notes: `May 2026 structure · 40/20/25/15 split`,
      },
      create: {
        employeeId: match.id,
        effectiveFrom: EFFECTIVE_FROM,
        basic: s.basic,
        hraPct: 40,
        conveyancePct: 20,
        medicalPct: 25,
        specialPct: 15,
        esiApplicable: s.esi,
        pfApplicable: true,
        professionalTax: s.pt,
        notes: `May 2026 structure · 40/20/25/15 split`,
      },
    });
    upserted++;
    console.log(
      `  ✓ ${s.matchKey.padEnd(28)} → ${match.name.padEnd(28)}  ` +
        `basic ₹${s.basic.toString().padStart(7)} · gross ₹${gross.toString().padStart(7)} · ` +
        `ESI ${s.esi ? "yes" : "no "} · PT ₹${s.pt}`,
    );
  }
  if (unmatched.length > 0) {
    console.log(`\n⚠ Unmatched in master: ${unmatched.join(", ")}`);
  }
  console.log(`\nDone. Upserted ${upserted} salary structure rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
