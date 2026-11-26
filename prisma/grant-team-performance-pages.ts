/**
 * Idempotent, additive grant of Team Performance pages (never removes a page,
 * so grants made in Role Management are kept):
 *
 *   - Admin roles and "HR Manager": every page (they also pass in code).
 *   - The role of each user in FULL_ACCESS_USERNAMES (Devika): every page.
 *     Everyone else on that role gets them too, so the script lists them.
 *
 * Other roles get pages through Role Management — e.g. Operations Manager /
 * Operations User with Candidate Support + Unanswered Queries.
 *
 *   npm run db:grant-team-performance -- --dry-run
 *   npm run db:grant-team-performance
 */
import { PrismaClient } from "@prisma/client";
import { TEAM_PERFORMANCE_PAGES } from "../src/lib/team-performance-rbac";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry-run");
const PAGES: string[] = [...TEAM_PERFORMANCE_PAGES];
const FULL_ACCESS_USERNAMES = ["devika"];

async function addAll(roleId: string, why: string) {
  const r = await prisma.role.findUniqueOrThrow({ where: { id: roleId } });
  const missing = PAGES.filter((p) => !r.pages.includes(p));
  if (!missing.length) {
    console.log(`• ${r.name} (${why}): already has every page`);
    return;
  }
  console.log(`${DRY ? "[dry-run] would add" : "✓ added"} ${missing.join(", ")} → ${r.name} (${why})`);
  if (!DRY) await prisma.role.update({ where: { id: r.id }, data: { pages: [...r.pages, ...missing] } });
}

async function main() {
  const roles = await prisma.role.findMany();
  for (const r of roles) {
    if (r.isAdmin) await addAll(r.id, "admin");
    else if (r.name.trim().toLowerCase() === "hr manager") await addAll(r.id, "HR Manager");
  }
  for (const username of FULL_ACCESS_USERNAMES) {
    const u = await prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      include: { roleRef: { include: { users: { select: { username: true } } } } },
    });
    if (!u?.roleRef) {
      console.warn(`! user "${username}" not found or has no role — skipped`);
      continue;
    }
    const others = u.roleRef.users.map((x) => x.username).filter((n) => n.toLowerCase() !== username);
    await addAll(u.roleRef.id, `role of ${username}`);
    if (others.length) console.warn(`  note: ${u.roleRef.name} is shared with ${others.join(", ")} — they get full access too`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
