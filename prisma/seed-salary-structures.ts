/**
 * Seed each active employee's HrSalaryStructure from the
 *   hr/Salary/Salary Corrections.xlsx  →  "Copy of Employee List" sheet.
 *
 * Matches employees by name (case-insensitive, partial). Skips entries
 * in the corrections file that don't match a master employee. Prints
 * unmatched names so HR can decide whether to add them.
 *
 * The corrections file stores **Basic** directly in column N (index 13)
 * along with the derived allowances. We trust Basic + the standard
 * 50/25/35/40 pcts (which the file itself uses — verified math).
 *
 * Idempotent — re-running upserts the same effectiveFrom row.
 *
 * Usage: npm run db:seed-salary-structures
 */
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { readFileSync } from "fs";

const prisma = new PrismaClient();

const CORRECTIONS_XLSX = "/Volumes/DESMA/AntiGravity/DESMA FINANCE/hr/Salary/Salary Corrections.xlsx";
const SHEET_NAME = "Copy of Employee List";

/// Effective-from for the seeded structures. Use Jan 1 of the current
/// year so the seeded structures cover historical payroll runs (Jan…
/// onwards) as well as the current month.
function effectiveFrom(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

function suggestPT(grossMonthly: number): number {
  const halfYear = grossMonthly * 6;
  if (halfYear >= 125_000) return 208;
  if (halfYear >= 100_000) return 167;
  return 125;
}

/** Normalise a name for matching — strip punctuation, lowercase, collapse spaces. */
function nameKey(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[.,\(\)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score 0..1 — higher is better. Matches names like "Ganga" against
 * "Gangapriya P" by checking:
 *   1. First-token exact match  → 1.0
 *   2. First-token prefix match (≥4 chars overlap)  → 0.9
 *   3. Any-token exact overlap  → overlap / min(sizes)
 */
function similarity(a: string, b: string): number {
  const aTokens = nameKey(a).split(" ").filter(Boolean);
  const bTokens = nameKey(b).split(" ").filter(Boolean);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aFirst = aTokens[0];
  const bFirst = bTokens[0];
  if (aFirst === bFirst) return 1;
  if (aFirst.length >= 4 && bFirst.length >= 4) {
    if (bFirst.startsWith(aFirst) || aFirst.startsWith(bFirst)) return 0.9;
  }
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let overlap = 0;
  for (const t of aSet) if (bSet.has(t)) overlap++;
  return overlap > 0 ? overlap / Math.min(aSet.size, bSet.size) : 0;
}

type Row = { sl: number; name: string; basic: number };

async function main() {
  console.log("Reading", CORRECTIONS_XLSX);
  const wb = XLSX.read(readFileSync(CORRECTIONS_XLSX), { cellDates: true });
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`Sheet "${SHEET_NAME}" not found`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][];

  // Header is on row 3 (index 2). Name is col B (idx 1), Basic is col N (idx 13).
  const dataRows: Row[] = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    const slRaw = String(r[0] ?? "").trim();
    const name = String(r[1] ?? "").trim();
    const basicRaw = String(r[13] ?? "").trim();
    if (!name || !basicRaw) continue;
    const sl = Number(slRaw);
    const basic = Number(basicRaw);
    if (!Number.isFinite(sl) || !Number.isFinite(basic) || basic <= 0) continue;
    dataRows.push({ sl, name, basic });
  }
  console.log(`Found ${dataRows.length} rows with Basic in "${SHEET_NAME}"`);

  const employees = await prisma.employee.findMany({
    where: { active: true },
    select: { id: true, empCode: true, name: true },
  });
  console.log(`Master has ${employees.length} active employees`);

  const eff = effectiveFrom();
  const matched: { row: Row; empId: string; empName: string }[] = [];
  const unmatched: Row[] = [];

  for (const row of dataRows) {
    let best: { id: string; name: string; score: number } | null = null;
    for (const e of employees) {
      const score = similarity(row.name, e.name);
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { id: e.id, name: e.name, score };
      }
    }
    if (best) {
      matched.push({ row, empId: best.id, empName: best.name });
    } else {
      unmatched.push(row);
    }
  }

  console.log("\nUpserting structures…");
  for (const m of matched) {
    const basic = m.row.basic;
    const gross = basic * 2.5; // 50+25+35+40 = 150% of basic, gross = basic × 2.5
    const pt = suggestPT(gross);
    const esiApplicable = gross <= 21000;
    await prisma.hrSalaryStructure.upsert({
      where: {
        employeeId_effectiveFrom: { employeeId: m.empId, effectiveFrom: eff },
      },
      update: {
        basic,
        hraPct: 50,
        conveyancePct: 25,
        medicalPct: 35,
        specialPct: 40,
        esiApplicable,
        pfApplicable: true,
        professionalTax: pt,
        notes: `Seeded from Salary Corrections.xlsx · ${m.row.name}`,
      },
      create: {
        employeeId: m.empId,
        effectiveFrom: eff,
        basic,
        hraPct: 50,
        conveyancePct: 25,
        medicalPct: 35,
        specialPct: 40,
        esiApplicable,
        pfApplicable: true,
        professionalTax: pt,
        notes: `Seeded from Salary Corrections.xlsx · ${m.row.name}`,
      },
    });
    console.log(
      `  ✓ ${m.row.name.padEnd(28)} → ${m.empName.padEnd(28)}  basic ₹${basic} · gross ₹${Math.round(gross)} · PT ₹${pt}`,
    );
  }

  if (unmatched.length > 0) {
    console.log(`\n⚠ ${unmatched.length} unmatched name(s) in corrections file (no master employee):`);
    for (const u of unmatched) {
      console.log(`  - ${u.name} (basic ₹${u.basic})`);
    }
  }

  const masterMatched = new Set(matched.map((m) => m.empId));
  const masterMissing = employees.filter((e) => !masterMatched.has(e.id));
  if (masterMissing.length > 0) {
    console.log(`\n⚠ ${masterMissing.length} master employee(s) without a structure (not in corrections file):`);
    for (const m of masterMissing) {
      console.log(`  - ${m.empCode} ${m.name}`);
    }
  }

  console.log(`\nDone. matched=${matched.length} unmatched=${unmatched.length} masterMissing=${masterMissing.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
