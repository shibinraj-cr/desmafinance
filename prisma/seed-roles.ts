/**
 * Seed the three built-in roles and migrate existing User.role string values
 * onto User.roleId. Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run db:seed-roles
 */
import { PrismaClient } from "@prisma/client";
import { ALL_PAGE_HREFS, DEFAULT_NON_ADMIN_PAGES } from "../src/lib/modules";

const prisma = new PrismaClient();

// System roles seed shape. The name is the *initial* name on first run; admins
// can rename in the UI later (e.g. "Manager" → "Finance Manager"). On re-run,
// upsert by name only creates the row if it doesn't already exist; renamed
// rows are matched via the LEGACY_NAMES alias array.
const SYSTEM_ROLES = [
  {
    name: "Admin",
    aliases: ["Admin"],
    description: "Full access. Manages users, roles, and all transactions.",
    isAdmin: true,
    canApprove: true,
    needsApproval: false,
    pages: ALL_PAGE_HREFS,
    isSystem: true,
  },
  {
    name: "Finance Manager",
    aliases: ["Finance Manager", "Manager"],
    description: "Approves pending changes; own creates/edits go in directly.",
    isAdmin: false,
    canApprove: true,
    needsApproval: false,
    pages: DEFAULT_NON_ADMIN_PAGES,
    isSystem: true,
  },
  {
    name: "Finance Executive",
    aliases: ["Finance Executive", "Executive"],
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
  manager: "Finance Manager",
  executive: "Finance Executive",
  user: "Finance Executive",
};

async function main() {
  console.log("Seeding system roles…");
  const roleByName = new Map<string, { id: string }>();
  for (const r of SYSTEM_ROLES) {
    // Try to find an existing record under any of the aliases (covers the case
    // where an admin has renamed the role).
    let existing = null;
    for (const alias of r.aliases) {
      existing = await prisma.role.findUnique({ where: { name: alias } });
      if (existing) break;
    }
    const { aliases: _aliases, ...createData } = r;
    if (existing) {
      // Don't overwrite the admin's renamed name or customised pages list.
      const updated = await prisma.role.update({
        where: { id: existing.id },
        data: {
          description: existing.description ?? r.description,
          isAdmin: r.isAdmin,
          canApprove: r.canApprove,
          needsApproval: r.needsApproval,
          isSystem: true,
        },
      });
      roleByName.set(r.name, { id: updated.id });
      // Also map any aliases so users referencing the old legacy string still
      // resolve.
      for (const a of r.aliases) roleByName.set(a, { id: updated.id });
      console.log(`  ✓ ${r.name}${updated.name !== r.name ? ` (kept renamed: ${updated.name})` : ""}`);
    } else {
      const created = await prisma.role.create({ data: createData });
      roleByName.set(r.name, { id: created.id });
      for (const a of r.aliases) roleByName.set(a, { id: created.id });
      console.log(`  ✓ ${r.name} (created)`);
    }
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
