/**
 * LOCAL-ONLY demo seeder for exercising the salary-adjustments feature.
 *
 * Creates, with zero external file dependencies:
 *   - an admin login user (ADMIN_USERNAME / ADMIN_PASSWORD, or admin / demopass123)
 *   - two demo employees + salary structures
 *   - a full cycle of "present" attendance for 2026-07 (26th Jun → 25th Jul)
 *   - a computed DRAFT salary run for 2026-07
 *
 * Then open /hr/salary → the 2026-07 run, click "Add" in the Adjustments column,
 * and add a deduction (e.g. Penalty −5000) and an addition (e.g. Incentive +3000).
 * The Net column, run Total, and the salary slip should all reflect them.
 *
 * SAFETY: refuses to run against the production database. It allows localhost or
 * a Neon BRANCH, but hard-blocks the known prod endpoint (see PROD_ENDPOINT_IDS).
 * Run it in a terminal where you've `export DATABASE_URL=<local-or-branch>` first:
 *   npx tsx prisma/dev-seed-adjustment-demo.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { computeSalaryRun } from "../src/lib/hr-salary-engine";
import { cycleWindowForMonth } from "../src/lib/hr-data";

const prisma = new PrismaClient();
const MONTH = "2026-07";

// Production Neon endpoint id(s). A branch gets a DIFFERENT ep-… id, so matching
// this substring blocks prod (pooler AND direct hosts share the id) while still
// allowing a branch or localhost. Update if the prod endpoint ever changes.
const PROD_ENDPOINT_IDS = ["ep-orange-brook-aqmaow18"];

function assertNotProd() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* fall through */
  }
  if (!host) {
    console.error("\n❌ Refusing to run: DATABASE_URL is unset or unparseable.\n");
    process.exit(1);
  }
  if (PROD_ENDPOINT_IDS.some((id) => host.includes(id))) {
    console.error(
      `\n❌ Refusing to run: DATABASE_URL host "${host}" is the PRODUCTION database.\n` +
        `   Point this terminal at a Neon branch or localhost first, e.g.:\n` +
        `     export DATABASE_URL="postgresql://…<your-branch-endpoint>…neon.tech/neondb?sslmode=require"\n`,
    );
    process.exit(1);
  }
  console.log(`✓ Target DB host: ${host} (not prod) — safe to seed.`);
}

const EMPLOYEES = [
  {
    empCode: "9001",
    name: "Demo Employee One",
    basic: 15000, // gross 30,000 at the 2× default → over the ESI ceiling
    accountNumber: "1234500001",
    ifsc: "HDFC0000001",
    bankName: "HDFC Bank",
    branch: "Demo Branch",
  },
  {
    empCode: "9002",
    name: "Demo Employee Two",
    basic: 9000, // gross 18,000 → within the ESI ceiling
    accountNumber: "1234500002",
    ifsc: "HDFC0000001",
    bankName: "HDFC Bank",
    branch: "Demo Branch",
  },
];

async function main() {
  assertNotProd();

  // --- admin login ---
  const username = (process.env.ADMIN_USERNAME ?? "admin").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "demopass123";
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role: "admin", isActive: true },
    create: { username, email: null, passwordHash, role: "admin", isActive: true },
  });
  console.log(`✓ Admin user: ${username} / ${password}`);

  // --- employees + structures ---
  const empIds: string[] = [];
  for (const e of EMPLOYEES) {
    const emp = await prisma.employee.upsert({
      where: { empCode: e.empCode },
      update: {
        name: e.name,
        active: true,
        accountNumber: e.accountNumber,
        ifsc: e.ifsc,
        bankName: e.bankName,
        branch: e.branch,
      },
      create: {
        empCode: e.empCode,
        name: e.name,
        active: true,
        accountNumber: e.accountNumber,
        ifsc: e.ifsc,
        bankName: e.bankName,
        branch: e.branch,
      },
    });
    empIds.push(emp.id);
    const effectiveFrom = new Date(Date.UTC(2026, 0, 1));
    await prisma.hrSalaryStructure.upsert({
      where: { employeeId_effectiveFrom: { employeeId: emp.id, effectiveFrom } },
      update: { basic: e.basic },
      create: { employeeId: emp.id, effectiveFrom, basic: e.basic },
    });
    console.log(`✓ Employee ${e.empCode} ${e.name} (basic ₹${e.basic})`);
  }

  // --- attendance for the 2026-07 cycle (26 Jun → 25 Jul), Sundays = week-off ---
  const { start, end } = cycleWindowForMonth(MONTH);
  const upload = await prisma.hrAttendanceUpload.create({
    data: { monthKey: MONTH, filename: "demo-seed", notes: "dev-seed-adjustment-demo" },
  });
  let dayCount = 0;
  for (const employeeId of empIds) {
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const status = date.getUTCDay() === 0 ? "WO" : "P"; // Sunday off, else present
      await prisma.hrAttendanceDay.upsert({
        where: { employeeId_date: { employeeId, date } },
        update: { status, uploadId: upload.id },
        create: { uploadId: upload.id, employeeId, date, status },
      });
      dayCount++;
    }
  }
  console.log(`✓ Attendance: ${dayCount} rows for ${MONTH} (${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)})`);

  // --- compute the draft run ---
  const run = await computeSalaryRun(MONTH, null);
  console.log(`✓ Salary run computed: ${run.lineCount} lines` + (run.warnings.length ? `, warnings: ${run.warnings.join("; ")}` : ""));

  console.log(
    `\nDone. Start the app in this same terminal (npm run dev), sign in as "${username}",\n` +
      `open /hr/salary → the ${MONTH} run, and use the Adjustments column to add a\n` +
      `deduction (Penalty −5000) and an addition (Incentive +3000). Watch Net, Total, and the slip.\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
