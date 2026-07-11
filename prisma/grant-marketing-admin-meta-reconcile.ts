/**
 * Idempotent grant: give the "Marketing Admin" role access to the CRM Meta
 * reconciliation tool (/crm/meta-reconcile) — upload a Meta leads export, pick a
 * date, and see which in-window leads are missing from the CRM.
 *
 * How access works here: pages are allow-listed on the ROLE (`Role.pages`).
 * Granting `/crm/meta-reconcile` flips `canSeePage()` on for that role (system
 * admins already pass canSeePage by default, so they see it implicitly). This
 * grants ONLY this page — not the rest of the CRM-admin tier (assign / import /
 * settings).
 *
 * Additive — never removes a page. Reports the blast radius (how many users are
 * on the role) before committing.
 *
 *   npx tsx prisma/grant-marketing-admin-meta-reconcile.ts            # DRY RUN
 *   npx tsx prisma/grant-marketing-admin-meta-reconcile.ts --commit   # apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAGE = "/crm/meta-reconcile";
const ROLE_NAME = "Marketing Admin";

async function main() {
  const commit = process.argv.slice(2).includes("--commit");
  console.log(`[grant] page : ${PAGE}`);
  console.log(`[grant] role : "${ROLE_NAME}"`);
  console.log(`[grant] mode : ${commit ? "COMMIT" : "DRY RUN"}\n`);

  const role = await prisma.role.findUnique({ where: { name: ROLE_NAME } });
  if (!role) {
    throw new Error(
      `No role named "${ROLE_NAME}". Create it first (POST /api/admin/setup-marketing-admin), then re-run.`,
    );
  }
  console.log(`• role: "${role.name}" (id=${role.id}) with ${role.pages.length} pages`);

  const users = await prisma.user.count({ where: { roleId: role.id } });
  console.log(`• ${users} user(s) on this role will gain ${PAGE}.`);

  if (role.pages.includes(PAGE)) {
    console.log(`\n✓ "${role.name}" already has ${PAGE} — nothing to do.`);
    return;
  }

  console.log(`\n${commit ? "✓" : "[dry-run] would"} add ${PAGE} to "${role.name}"`);
  if (!commit) {
    console.log(`\n[grant] DRY RUN — nothing written. Re-run with --commit to apply.`);
    return;
  }

  await prisma.role.update({ where: { id: role.id }, data: { pages: [...role.pages, PAGE] } });
  console.log(`\ndone — the "${role.name}" role can now use Meta reconciliation at ${PAGE}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
