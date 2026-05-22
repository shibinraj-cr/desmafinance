/**
 * Idempotent grant: adds /finance/collection-plan to the `pages` array
 * of every Role that already has /finance/daily-tracker.
 *
 *   npx tsx prisma/grant-collection-plan-page.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const NEW_PAGE = "/finance/collection-plan";
const ANCHOR = "/finance/daily-tracker";

async function main() {
  const roles = await prisma.role.findMany();
  let updated = 0;
  let skipped = 0;
  for (const r of roles) {
    if (!r.pages.includes(ANCHOR)) {
      skipped++;
      continue;
    }
    if (r.pages.includes(NEW_PAGE)) {
      skipped++;
      continue;
    }
    await prisma.role.update({
      where: { id: r.id },
      data: { pages: [...r.pages, NEW_PAGE] },
    });
    console.log(`✓ ${r.name}: added ${NEW_PAGE}`);
    updated++;
  }
  console.log(`done — ${updated} updated, ${skipped} skipped`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
