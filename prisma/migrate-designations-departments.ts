/**
 * One-time migration:
 *   - Promote distinct Employee.designation free-text values to
 *     HrDesignation rows; set Employee.designationId.
 *   - Promote distinct Employee.department free-text values to
 *     HrDepartment rows; create an HrEmployeeDepartment row with
 *     isPrimary=true.
 *
 * Designation seniority levels are inferred from common title keywords:
 *   "Director / Founder" → 100
 *   "Senior Manager"     →  80
 *   "Deputy Manager"     →  70
 *   "Assistant Manager"  →  60
 *   "Manager"            →  75   (only if not matched above)
 *   "Senior Executive"   →  40
 *   "Executive"          →  30
 *   "Officer"            →  25
 *   "Trainee"            →  10
 *   (default)            →  20
 *
 * Idempotent — safe to re-run.
 * Usage:  npx tsx prisma/migrate-designations-departments.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function inferLevel(name: string): number {
  const t = name.toLowerCase();
  if (/director|founder|ceo|coo|cto|cfo/.test(t)) return 100;
  if (/senior manager|sr\.?\s*manager/.test(t)) return 80;
  if (/deputy manager/.test(t)) return 70;
  if (/assistant manager|asst\.?\s*manager/.test(t)) return 60;
  if (/\bmanager\b/.test(t)) return 75;
  if (/senior executive|sr\.?\s*executive|lead/.test(t)) return 40;
  if (/\bexecutive\b/.test(t)) return 30;
  if (/\bofficer\b/.test(t)) return 25;
  if (/trainee|intern/.test(t)) return 10;
  return 20;
}

/// Pull the title prefix before " - " (so "Senior Manager - Finance" → "Senior Manager").
function shortDesignation(raw: string): string {
  const trimmed = raw.trim();
  const dash = trimmed.indexOf(" - ");
  return dash >= 0 ? trimmed.slice(0, dash).trim() : trimmed;
}

async function main() {
  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      empCode: true,
      name: true,
      designation: true,
      department: true,
      designationId: true,
    },
  });
  console.log(`Scanning ${employees.length} employees…\n`);

  // 1. Distinct designations → HrDesignation rows
  const distinctDesignations = new Set<string>();
  for (const e of employees) {
    if (e.designation) distinctDesignations.add(shortDesignation(e.designation));
  }
  console.log(`Found ${distinctDesignations.size} distinct designation(s):`);
  const designationIdByName = new Map<string, string>();
  for (const name of distinctDesignations) {
    if (!name) continue;
    const level = inferLevel(name);
    const d = await prisma.hrDesignation.upsert({
      where: { name },
      update: {},
      create: { name, level },
    });
    designationIdByName.set(name, d.id);
    console.log(`  ✓ ${name.padEnd(40)} level=${level}`);
  }

  // 2. Distinct departments → HrDepartment rows (split on comma so
  //    "Sales & Marketing, Multimedia Production" becomes two dept rows).
  const distinctDepartments = new Set<string>();
  for (const e of employees) {
    if (!e.department) continue;
    for (const piece of e.department.split(/[,;]+/)) {
      const t = piece.trim();
      if (t) distinctDepartments.add(t);
    }
  }
  console.log(`\nFound ${distinctDepartments.size} distinct department(s):`);
  const departmentIdByName = new Map<string, string>();
  for (const name of distinctDepartments) {
    const d = await prisma.hrDepartment.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    departmentIdByName.set(name, d.id);
    console.log(`  ✓ ${name}`);
  }

  // 3. Link each employee to designation + departments
  console.log(`\nLinking employees…`);
  for (const e of employees) {
    // Designation link
    if (e.designation && !e.designationId) {
      const dName = shortDesignation(e.designation);
      const dId = designationIdByName.get(dName);
      if (dId) {
        await prisma.employee.update({
          where: { id: e.id },
          data: { designationId: dId },
        });
      }
    }
    // Department link(s)
    if (e.department) {
      const pieces = e.department
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (let i = 0; i < pieces.length; i++) {
        const depId = departmentIdByName.get(pieces[i]);
        if (!depId) continue;
        await prisma.hrEmployeeDepartment.upsert({
          where: {
            employeeId_departmentId: { employeeId: e.id, departmentId: depId },
          },
          update: {},
          create: {
            employeeId: e.id,
            departmentId: depId,
            isPrimary: i === 0, // first listed = primary
          },
        });
      }
    }
    console.log(`  ✓ ${e.empCode} ${e.name}`);
  }

  console.log(`\nDone.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
