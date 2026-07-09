/**
 * Grant CRM lead-assignment + History-tab access to the sales-team lead.
 *
 * Adds two NARROW capability markers to the "Sales Team Lead" role:
 *   - /crm/assign  → canAssign      (assign / reassign leads to consultants)
 *   - /crm/history → canViewHistory (full lead History tab)
 * WITHOUT the rest of the CRM-admin tier (bulk import, bulk email, Settings).
 * These are the CRM_ASSIGN_PAGE / CRM_HISTORY_PAGE markers read by
 * getCrmAccess() — pure permission flags, not routes (they never render in nav).
 *
 * Devika is already on the "Sales Team Lead" role (see grant-crm-team-access.ts),
 * so granting the role these markers unlocks reassignment + history for her.
 * Run AFTER the crm-rbac.ts change that reads these markers has deployed.
 *
 * Idempotent + additive (never removes a page). Preview first with --dry-run.
 *
 *   npx tsx prisma/grant-crm-assign-access.ts --dry-run
 *   npx tsx prisma/grant-crm-assign-access.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry-run");

const ASSIGN_MARKER = "/crm/assign"; // keep in sync with CRM_ASSIGN_PAGE in crm-rbac.ts
const HISTORY_MARKER = "/crm/history"; // keep in sync with CRM_HISTORY_PAGE in crm-rbac.ts
const MARKERS = [ASSIGN_MARKER, HISTORY_MARKER];
const LEAD_ROLE_NAME = "Sales Team Lead";

const tag = DRY ? "[dry-run] would" : "✓";

async function main() {
  const role = await prisma.role.findFirst({ where: { name: LEAD_ROLE_NAME } });
  if (!role) {
    console.log(`! role "${LEAD_ROLE_NAME}" not found — run grant-crm-team-access.ts first`);
    return;
  }

  const missing = MARKERS.filter((m) => !role.pages.includes(m));
  if (!missing.length) {
    console.log(`• "${LEAD_ROLE_NAME}" already has ${MARKERS.join(", ")}`);
  } else {
    console.log(`${tag} add ${missing.join(", ")} to "${LEAD_ROLE_NAME}"`);
    if (!DRY) {
      await prisma.role.update({
        where: { id: role.id },
        data: { pages: [...role.pages, ...missing] },
      });
    }
  }

  // Show exactly who this affects (the marker lives on the role, not the user).
  const users = await prisma.user.findMany({
    where: { roleId: role.id },
    select: { username: true },
  });
  console.log(`  affects ${users.length} user(s): ${users.map((u) => u.username).join(", ") || "(none)"}`);

  console.log(DRY ? "\ndry-run complete — no writes" : "\ndone");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
