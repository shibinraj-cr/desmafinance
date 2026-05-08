/**
 * Idempotent: copies the legacy Party↔Service M:M (`_PartyToService`)
 * into the explicit `PartyService` join with `totalAmount = 0`.
 *
 * Re-running is safe — it skips rows that already exist in
 * `PartyService` for the same (partyId, serviceId).
 *
 * Run via:  npm run db:migrate-party-services
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Read the implicit M:M directly via raw SQL — it's not exposed as a
  // model but Prisma's underlying `_PartyToService` table still exists
  // until we drop the legacy `services` relation from the schema.
  let legacyRows: Array<{ A: string; B: string }> = [];
  try {
    legacyRows = await prisma.$queryRawUnsafe<Array<{ A: string; B: string }>>(
      'SELECT "A", "B" FROM "_PartyToService"',
    );
  } catch {
    console.log("No legacy _PartyToService table found — nothing to migrate.");
    return;
  }

  if (legacyRows.length === 0) {
    console.log("Legacy _PartyToService is empty — nothing to migrate.");
    return;
  }
  console.log(`Found ${legacyRows.length} legacy Party↔Service links.`);

  let created = 0;
  let skipped = 0;
  for (const row of legacyRows) {
    // `_PartyToService` columns: A = Party.id, B = Service.id (Prisma
    // sorts the model names alphabetically when generating the
    // implicit table, so Party (P) comes before Service (S) → A=Party).
    const partyId = row.A;
    const serviceId = row.B;
    const existing = await prisma.partyService.findUnique({
      where: { partyId_serviceId: { partyId, serviceId } },
    });
    if (existing) {
      skipped++;
      continue;
    }
    await prisma.partyService.create({
      data: { partyId, serviceId, totalAmount: 0 },
    });
    created++;
  }

  console.log(`\n========= SUMMARY =========`);
  console.log(`Created  : ${created}`);
  console.log(`Skipped  : ${skipped} (already in PartyService)`);
  console.log(`Total    : ${legacyRows.length}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
