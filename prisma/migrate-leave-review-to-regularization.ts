/**
 * Leave Review was folded into Attendance Corrections (/hr/regularization, tab
 * "leave"). For every role that could reach the old /hr/leave-review page:
 *   - grant /hr/regularization (so leave decisions stay reachable), and
 *   - drop the now-dead /hr/leave-review page.
 *
 *   npx tsx prisma/migrate-leave-review-to-regularization.ts            # DRY RUN
 *   npx tsx prisma/migrate-leave-review-to-regularization.ts --commit
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const OLD = "/hr/leave-review";
const NEW = "/hr/regularization";

async function main() {
  const commit = process.argv.includes("--commit");
  const roles = await prisma.role.findMany({ select: { id: true, name: true, pages: true } });
  let changed = 0;
  for (const r of roles) {
    if (!r.pages.includes(OLD)) continue;
    const next = r.pages.filter((p) => p !== OLD);
    if (!next.includes(NEW)) next.push(NEW);
    console.log(`${r.name}: ${r.pages.includes(NEW) ? "drop leave-review" : "drop leave-review + add regularization"}`);
    changed++;
    if (commit) await prisma.role.update({ where: { id: r.id }, data: { pages: next } });
  }
  console.log(commit ? `\n✓ updated ${changed} role(s)` : `\nDRY RUN — ${changed} role(s) would change. Pass --commit.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
