/**
 * Idempotent grant: give Suhaina access to the CRM Activity page (/crm/team) so
 * it appears in her nav and she can open the team activity + follow-up queue.
 *
 * How access works here: pages are allow-listed on the user's ROLE
 * (`Role.pages`), and `canSeePage` prefix-matches — so `/crm/team` also unlocks
 * the drill-down `/crm/team/queue`. Suhaina is a Lead Pulse *supervisor*, so she
 * already PASSES the page's `canViewLeads` guard; this grant only makes the page
 * visible in her sidebar. Adding the page to her role affects anyone else on the
 * same role (today that's her "Marketing Admin" role) — reported below so you can
 * see the blast radius before committing.
 *
 * Finds Suhaina by username "suhaina" (case-insensitive), falling back to her
 * Lead Pulse displayName "Suhaina". Additive — never removes a page.
 *
 *   npx tsx prisma/grant-suhaina-crm-team.ts            # DRY RUN (report only)
 *   npx tsx prisma/grant-suhaina-crm-team.ts --commit   # apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PAGE = "/crm/team";
const USERNAME = "suhaina";
const DISPLAY_NAME = "Suhaina";

async function findSuhaina() {
  const byUsername = await prisma.user.findFirst({
    where: { username: { equals: USERNAME, mode: "insensitive" } },
    include: { roleRef: true, leadPulseRole: true },
  });
  if (byUsername) return byUsername;

  const lp = await prisma.leadPulseRole.findFirst({
    where: { displayName: { equals: DISPLAY_NAME, mode: "insensitive" } },
    include: { user: { include: { roleRef: true, leadPulseRole: true } } },
  });
  return lp?.user ?? null;
}

async function main() {
  const commit = process.argv.slice(2).includes("--commit");
  console.log(`[grant] page : ${PAGE}`);
  console.log(`[grant] user : Suhaina (username="${USERNAME}" / lead-pulse="${DISPLAY_NAME}")`);
  console.log(`[grant] mode : ${commit ? "COMMIT" : "DRY RUN"}\n`);

  const user = await findSuhaina();
  if (!user) {
    throw new Error(`No user matched username "${USERNAME}" or Lead Pulse name "${DISPLAY_NAME}".`);
  }
  console.log(`• found user: ${user.username} (id=${user.id})`);
  console.log(`• lead-pulse role: ${user.leadPulseRole?.role ?? "—"} (${user.leadPulseRole?.displayName ?? "—"})`);

  if (!user.roleId || !user.roleRef) {
    throw new Error(
      `Suhaina is not on a managed Role (roleId is null) — assign her a role in ` +
        `User Management first, then re-run. (Her legacy role string is "${user.role}".)`,
    );
  }
  const role = user.roleRef;
  console.log(`• role: "${role.name}" (id=${role.id}) with ${role.pages.length} pages`);

  const others = await prisma.user.count({ where: { roleId: role.id, id: { not: user.id } } });
  if (others > 0) {
    console.log(`  ⚠ ${others} other user(s) share this role — they will also gain ${PAGE}.`);
  }

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
  console.log(`\ndone — ${user.username} can now see ${PAGE} in her nav.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
