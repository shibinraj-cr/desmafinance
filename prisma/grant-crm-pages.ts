/**
 * Idempotent grant: adds the CRM page hrefs to the roles that should see them.
 *
 *   - Admin roles (isAdmin) get every CRM page, including /crm/settings.
 *   - Roles that already have Lead Pulse access (the ANCHOR page) get the
 *     /crm/leads page — these are the marketing / BDE roles for whom the CRM
 *     is intended.
 *
 * Re-runnable: skips roles that already have the pages, and roles that don't
 * qualify. (seed-roles.ts does NOT overwrite an existing role's `pages` on
 * re-run, so existing installs need this script — exactly like
 * grant-collection-plan-page.ts.)
 *
 *   npm run db:grant-crm-pages      (or: npx tsx prisma/grant-crm-pages.ts)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ANCHOR = "/marketing/lead-pulse";
const VIEWER_PAGES = ["/crm/leads", "/crm/tasks", "/crm/team"];
const ADMIN_PAGES = ["/crm/leads", "/crm/tasks", "/crm/team", "/crm/settings"];

async function main() {
  const roles = await prisma.role.findMany();
  let updated = 0;
  let skipped = 0;

  for (const r of roles) {
    const target = r.isAdmin
      ? ADMIN_PAGES
      : r.pages.includes(ANCHOR)
        ? VIEWER_PAGES
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
    await prisma.role.update({
      where: { id: r.id },
      data: { pages: [...r.pages, ...missing] },
    });
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
