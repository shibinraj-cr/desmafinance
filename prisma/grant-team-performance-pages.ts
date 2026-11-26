/**
 * Idempotent grant: adds the Team Performance pages to the Admin and
 * HR Manager roles so the module shows in their sidebar.
 *
 * Access is ALSO enforced in code (src/lib/team-performance-rbac.ts):
 * only admins and the "HR Manager" role can open the pages, even if the
 * pages are later ticked for another role in Role Management. This script
 * removes the pages from any other role that has them, so the sidebar
 * never shows a module the role can't open.
 *
 *   npm run db:grant-team-performance
 */
import { PrismaClient } from "@prisma/client";
import { TEAM_PERFORMANCE_PAGES } from "../src/lib/team-performance-rbac";

const prisma = new PrismaClient();
const PAGES: string[] = [...TEAM_PERFORMANCE_PAGES];

async function main() {
  const roles = await prisma.role.findMany();
  let added = 0;
  let removed = 0;
  for (const r of roles) {
    const allowed = r.isAdmin || r.name.trim().toLowerCase() === "hr manager";
    if (allowed) {
      const missing = PAGES.filter((p) => !r.pages.includes(p));
      if (!missing.length) continue;
      await prisma.role.update({ where: { id: r.id }, data: { pages: [...r.pages, ...missing] } });
      console.log(`✓ ${r.name}: added ${missing.join(", ")}`);
      added++;
    } else {
      const keep = r.pages.filter((p) => !p.startsWith("/performance/"));
      if (keep.length === r.pages.length) continue;
      await prisma.role.update({ where: { id: r.id }, data: { pages: keep } });
      console.log(`✗ ${r.name}: removed Team Performance pages`);
      removed++;
    }
  }
  if (!roles.some((r) => r.name.trim().toLowerCase() === "hr manager")) {
    console.warn("! No role named \"HR Manager\" found — only admins can open Team Performance.");
  }
  console.log(`done — ${added} granted, ${removed} cleaned`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
