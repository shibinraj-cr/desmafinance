/**
 * Provision CRM Team Activity access (run after the /crm/team feature deploys):
 *
 *   1. Self-view — grant /crm/team to the BDE roles (L2, L1 CRM) so every
 *      consultant sees their own Team Activity tab + dashboard.
 *   2. Team lead — ensure a "Sales Team Lead" role (cloned from L2 + the
 *      view-only team marker /crm/team-all) and move Devika onto it, so she sees
 *      the WHOLE team's Team Activity (with a "Just me" toggle) while staying a
 *      normal L2 BDE. The marker is NOT a route — purely a capability flag read
 *      by getCrmAccess().
 *
 * Idempotent + additive (never removes a page). Preview first with --dry-run.
 *
 *   npx tsx prisma/grant-crm-team-access.ts --dry-run
 *   npx tsx prisma/grant-crm-team-access.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry-run");

const TEAM_PAGE = "/crm/team";
const TEAM_LEAD_MARKER = "/crm/team-all"; // keep in sync with CRM_TEAM_LEAD_PAGE in crm-rbac.ts
const BDE_ROLE_NAMES = ["L2", "L1 CRM"];
const LEAD_ROLE_NAME = "Sales Team Lead";
const TEAM_LEAD_DISPLAY_NAME = "Devika";

const tag = DRY ? "[dry-run] would" : "✓";

async function main() {
  // 1) BDE self-view: add /crm/team to L2 + L1 CRM.
  const bdeRoles = await prisma.role.findMany({ where: { name: { in: BDE_ROLE_NAMES } } });
  for (const r of bdeRoles) {
    if (r.pages.includes(TEAM_PAGE)) {
      console.log(`• ${r.name}: already has ${TEAM_PAGE}`);
      continue;
    }
    console.log(`${tag} add ${TEAM_PAGE} to ${r.name}`);
    if (!DRY) await prisma.role.update({ where: { id: r.id }, data: { pages: [...r.pages, TEAM_PAGE] } });
  }
  for (const n of BDE_ROLE_NAMES) {
    if (!bdeRoles.some((r) => r.name === n)) console.log(`! role "${n}" not found`);
  }

  // 2) Sales Team Lead role, cloned from L2 + the two team pages.
  const l2 = await prisma.role.findFirst({ where: { name: "L2" } });
  if (!l2) {
    console.log('! "L2" role not found — cannot build the Sales Team Lead role');
    return;
  }
  const desiredPages = Array.from(new Set([...l2.pages, TEAM_PAGE, TEAM_LEAD_MARKER]));
  let leadRole = await prisma.role.findFirst({ where: { name: LEAD_ROLE_NAME } });
  if (!leadRole) {
    console.log(`${tag} create role "${LEAD_ROLE_NAME}" (${desiredPages.length} pages incl. ${TEAM_LEAD_MARKER})`);
    if (!DRY) {
      leadRole = await prisma.role.create({
        data: {
          name: LEAD_ROLE_NAME,
          description: "L2 consultant who also oversees the whole team's CRM Team Activity (view-only).",
          isAdmin: l2.isAdmin,
          canApprove: l2.canApprove,
          needsApproval: l2.needsApproval,
          pages: desiredPages,
        },
      });
    }
  } else {
    const missing = desiredPages.filter((p) => !leadRole!.pages.includes(p));
    if (missing.length) {
      console.log(`${tag} add ${missing.join(", ")} to "${LEAD_ROLE_NAME}"`);
      if (!DRY) leadRole = await prisma.role.update({ where: { id: leadRole.id }, data: { pages: [...leadRole.pages, ...missing] } });
    } else {
      console.log(`• "${LEAD_ROLE_NAME}" already has the required pages`);
    }
  }

  // 3) Move Devika onto the Sales Team Lead role (matched by Lead Pulse name).
  const matches = await prisma.leadPulseRole.findMany({
    where: { displayName: { equals: TEAM_LEAD_DISPLAY_NAME, mode: "insensitive" } },
    include: { user: { select: { id: true, username: true, roleId: true } } },
  });
  if (matches.length !== 1) {
    console.log(`! found ${matches.length} users named "${TEAM_LEAD_DISPLAY_NAME}" in Lead Pulse — skipping auto-assign; set her role in the admin UI`);
  } else {
    const u = matches[0].user;
    if (!leadRole) {
      console.log(`! "${LEAD_ROLE_NAME}" not created yet (dry-run) — re-run without --dry-run to assign ${u.username}`);
    } else if (u.roleId === leadRole.id) {
      console.log(`• ${u.username} already on "${LEAD_ROLE_NAME}"`);
    } else {
      console.log(`${tag} move ${u.username} → "${LEAD_ROLE_NAME}" role`);
      if (!DRY) await prisma.user.update({ where: { id: u.id }, data: { roleId: leadRole.id } });
    }
  }

  console.log(DRY ? "\ndry-run complete — no writes" : "\ndone");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
