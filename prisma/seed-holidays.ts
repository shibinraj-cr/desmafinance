/**
 * Seed the 2026 annual holiday calendar. Shared by both Marketing and
 * HR — only one source of truth (the `Holiday` table).
 *
 * Idempotent — upserts by date. Re-running rewrites labels but keeps
 * ids stable.
 *
 * Usage: npm run db:seed-holidays
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HOLIDAYS_2026: { date: string; label: string; notes?: string }[] = [
  { date: "2026-01-26", label: "Republic Day" },
  { date: "2026-03-20", label: "Eid al Fitr" },
  { date: "2026-04-03", label: "Good Friday" },
  { date: "2026-04-09", label: "ELECTION" },
  { date: "2026-04-15", label: "Vishu" },
  { date: "2026-05-01", label: "May Day" },
  { date: "2026-05-28", label: "Bakrid" },
  { date: "2026-08-15", label: "Independence Day" },
  { date: "2026-08-26", label: "Thiruvonam" },
  { date: "2026-08-27", label: "Avittom" },
  { date: "2026-10-02", label: "Gandhi Jayanthi" },
  { date: "2026-12-25", label: "Christmas" },
];

async function main() {
  console.log(`Seeding ${HOLIDAYS_2026.length} holidays into the shared Holiday table…\n`);
  for (const h of HOLIDAYS_2026) {
    const date = new Date(`${h.date}T00:00:00.000Z`);
    const saved = await prisma.holiday.upsert({
      where: { date },
      update: { label: h.label, notes: h.notes ?? null, paid: true },
      create: { date, label: h.label, notes: h.notes ?? null, paid: true },
    });
    const weekday = saved.date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    console.log(`  ✓ ${h.date} (${weekday})  ${saved.label}`);
  }
  const total = await prisma.holiday.count();
  console.log(`\nDone. Holiday table now has ${total} row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
