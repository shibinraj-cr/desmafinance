/**
 * Idempotent grant: give the "Marketing Admin" role access to the BDE
 * Enrollment dashboard (/crm/team/bde-enrollment), which is otherwise
 * admin-only (money view of enrolment & conversion).
 *
 * Pages are allow-listed on the ROLE (`Role.pages`), and the page itself
 * checks `perms.isAdmin || canSeePage(perms, CRM_BDE_ENROLLMENT_PAGE)`
 * (src/app/(app)/crm/team/bde-enrollment/page.tsx). Adding the page to this
 * role affects every user on it — reported below so you can see the blast
 * radius before committing.
 *
 * Additive — never removes a page.
 *
 *   npx tsx prisma/grant-marketing-admin-bde-enrollment.ts            # DRY RUN
 *   npx tsx prisma/grant-marketing-admin-bde-enrollment.ts --commit   # apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAGE = "/crm/team/bde-enrollment";
const ROLE_NAME = "Marketing Admin";

async function main() {
  const commit = process.argv.slice(2).includes("--commit");
  console.log(`[grant] page : ${PAGE}`);
  console.log(`[grant] role : "${ROLE_NAME}"`);
  console.log(`[grant] mode : ${commit ? "COMMIT" : "DRY RUN"}\n`);

  const role = await prisma.role.findUnique({ where: { name: ROLE_NAME } });
  if (!role) throw new Error(`No Role named "${ROLE_NAME}" found.`);
  console.log(`• role: "${role.name}" (id=${role.id}) with ${role.pages.length} pages`);

  const members = await prisma.user.findMany({
    where: { roleId: role.id },
    select: { username: true },
  });
  console.log(`• ${members.length} user(s) on this role: ${members.map((m) => m.username).join(", ")}`);

  if (role.pages.includes(PAGE)) {
    console.log(`\n✓ "${role.name}" already has ${PAGE} — nothing to do.`);
    return;
  }

  console.log(`\n${commit ? "✓" : "[dry-run] would"} add ${PAGE} to "${role.name}"`);
  if (!commit) {
    console.log(`\n[grant] DRY RUN — nothing written. Re-run with --commit to apply.`);
    return;
  }

  await prisma.role.update({
    where: { id: role.id },
    data: { pages: [...role.pages, PAGE] },
  });
  console.log(`\ndone — "${role.name}" can now see ${PAGE} in nav.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
