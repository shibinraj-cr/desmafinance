/**
 * Idempotent grant: give the "Marketing Admin" role access to the CRM
 * reconciliation tools — the Voxbay call reconcile (/crm/voxbay-reconcile) and,
 * for good measure, the Meta reconcile (/crm/meta-reconcile). Adds whichever
 * pages are missing; leaves everything else on the role untouched.
 *
 * Access model: pages are allow-listed on the ROLE (`Role.pages`). Granting a
 * `/crm/...` href flips `canSeePage()` on for that role (system admins already
 * pass by default). This grants ONLY these pages — not the CRM-admin tier.
 *
 *   npx tsx prisma/grant-marketing-admin-voxbay-reconcile.ts            # DRY RUN
 *   npx tsx prisma/grant-marketing-admin-voxbay-reconcile.ts --commit   # apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAGES = ["/crm/voxbay-reconcile", "/crm/meta-reconcile"];
const ROLE_NAME = "Marketing Admin";

async function main() {
  const commit = process.argv.slice(2).includes("--commit");
  console.log(`[grant] pages: ${PAGES.join(", ")}`);
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
  const missing = PAGES.filter((p) => !role.pages.includes(p));
  if (missing.length === 0) {
    console.log(`\n✓ "${role.name}" already has all ${PAGES.length} pages — nothing to do.`);
    return;
  }
  console.log(`• ${users} user(s) on this role will gain: ${missing.join(", ")}`);

  console.log(`\n${commit ? "✓" : "[dry-run] would"} add ${missing.length} page(s) to "${role.name}"`);
  if (!commit) {
    console.log(`\n[grant] DRY RUN — nothing written. Re-run with --commit to apply.`);
    return;
  }

  await prisma.role.update({ where: { id: role.id }, data: { pages: [...role.pages, ...missing] } });
  console.log(`\ndone — the "${role.name}" role can now use the CRM reconciliation tools.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
