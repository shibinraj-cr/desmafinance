/**
 * Seed the three built-in roles and migrate existing User.role string values
 * onto User.roleId. Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run db:seed-roles
 */
import { PrismaClient } from "@prisma/client";
import { ALL_PAGE_HREFS, DEFAULT_NON_ADMIN_PAGES } from "../src/lib/pages";

const prisma = new PrismaClient();

const SYSTEM_ROLES = [
  {
    name: "Admin",
    description: "Full access. Manages users, roles, and all transactions.",
    isAdmin: true,
    canApprove: true,
    needsApproval: false,
    pages: ALL_PAGE_HREFS,
    isSystem: true,
  },
  {
    name: "Manager",
    description: "Approves pending changes; own creates/edits go in directly.",
    isAdmin: false,
    canApprove: true,
    needsApproval: false,
    pages: DEFAULT_NON_ADMIN_PAGES,
    isSystem: true,
  },
  {
    name: "Executive",
    description: "Records transactions; changes need manager approval.",
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    pages: DEFAULT_NON_ADMIN_PAGES,
    isSystem: true,
  },
];

const LEGACY_TO_NAME: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  executive: "Executive",
  user: "Executive",
};

async function main() {
  console.log("Seeding system roles…");
  const roleByName = new Map<string, { id: string }>();
  for (const r of SYSTEM_ROLES) {
    const upserted = await prisma.role.upsert({
      where: { name: r.name },
      update: {
        description: r.description,
        isAdmin: r.isAdmin,
        canApprove: r.canApprove,
        needsApproval: r.needsApproval,
        // Don't overwrite a pages list an admin has customised on a system role.
        // Only set if the role is being created.
      },
      create: { ...r },
    });
    roleByName.set(r.name, { id: upserted.id });
    console.log(`  ✓ ${r.name}`);
  }

  console.log("\nLinking existing users to roles…");
  const users = await prisma.user.findMany({
    where: { roleId: null },
    select: { id: true, username: true, role: true },
  });
  for (const u of users) {
    const target = LEGACY_TO_NAME[u.role] ?? "Executive";
    const r = roleByName.get(target);
    if (!r) continue;
    await prisma.user.update({ where: { id: u.id }, data: { roleId: r.id } });
    console.log(`  ✓ ${u.username} → ${target}`);
  }
  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
