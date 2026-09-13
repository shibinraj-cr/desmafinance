/**
 * Idempotent grant: adds the SOP Management page hrefs to the roles that should
 * see them. Clone of grant-operations-pages.ts, for installs where seed-roles.ts
 * will not overwrite an existing role's `pages`.
 *
 *   - Admin roles and a role literally named "SOP Admin" get every SOP page.
 *   - "SOP Author" / "Process Owner" get the authoring + governance pages.
 *   - Every other role is left alone: the reading pages (/sop/library,
 *     /sop/my-sops) need no grant at all — they are in ALWAYS_VISIBLE_PAGES —
 *     so a plain employee can already read and acknowledge SOPs.
 *
 * Re-runnable: skips roles that already hold the pages.
 *
 *   npm run db:grant-sop-pages   (or: npx tsx prisma/grant-sop-pages.ts)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_PAGES = [
  "/sop/dashboard",
  "/sop/library",
  "/sop/create",
  "/sop/my-sops",
  "/sop/review",
  "/sop/kpi-reviews",
  "/sop/acknowledgements",
  "/sop/archived",
  "/sop/settings",
];

// Everything an author or process owner needs, minus the admin-tier pages —
// notably NOT /sop/settings, which is what mints a SOP admin.
const AUTHOR_PAGES = [
  "/sop/dashboard",
  "/sop/library",
  "/sop/create",
  "/sop/my-sops",
  "/sop/review",
  "/sop/kpi-reviews",
  "/sop/acknowledgements",
];

async function main() {
  const roles = await prisma.role.findMany();
  let updated = 0;
  let skipped = 0;

  for (const r of roles) {
    const target =
      r.isAdmin || r.name === "SOP Admin"
        ? ADMIN_PAGES
        : r.name === "SOP Author" || r.name === "Process Owner"
          ? AUTHOR_PAGES
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
  console.log(
    "Note: /sop/library and /sop/my-sops need no grant — every signed-in user can read published SOPs.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
