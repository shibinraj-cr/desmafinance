/**
 * Idempotent grant: adds the Operations page hrefs to the roles that should see
 * them, for existing installs where seed-roles.ts won't overwrite an existing
 * role's `pages`. Clone of grant-crm-pages.ts.
 *
 *   - Admin roles + "Operations Manager" get every Operations page.
 *   - "Operations User" gets the worker pages (My Work + Projects).
 *
 * Re-runnable: skips roles already holding the pages, and roles that don't
 * qualify.
 *
 *   npm run db:grant-operations-pages   (or: npx tsx prisma/grant-operations-pages.ts)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MANAGER_PAGES = ["/operations/my-work", "/operations/projects", "/operations/templates", "/operations/settings"];
const USER_PAGES = ["/operations/my-work", "/operations/projects"];

async function main() {
  const roles = await prisma.role.findMany();
  let updated = 0;
  let skipped = 0;

  for (const r of roles) {
    const target =
      r.isAdmin || r.name === "Operations Manager"
        ? MANAGER_PAGES
        : r.name === "Operations User"
          ? USER_PAGES
          : null;

    if (!target) {
      skipped++;
      continue;
    }
    const missing = target.filter((p) => !r.pages.includes(p));
    if (missing.length === 0) {
      skipped++;
      continue;
    }
    await prisma.role.update({ where: { id: r.id }, data: { pages: [...r.pages, ...missing] } });
    console.log(`✓ ${r.name}: added ${missing.join(", ")}`);
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
