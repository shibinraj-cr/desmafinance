/**
 * Seed the three built-in roles and migrate existing User.role string values
 * onto User.roleId. Idempotent — safe to re-run.
 *
 * Usage:
 *   npm run db:seed-roles
 */
import { PrismaClient } from "@prisma/client";
import { ALL_PAGE_HREFS, DEFAULT_NON_ADMIN_PAGES, MODULES } from "../src/lib/modules";

const prisma = new PrismaClient();

const HR_PAGES = MODULES.find((m) => m.id === "hr")?.pages.map((p) => p.href) ?? [];
const ME_PAGES = MODULES.find((m) => m.id === "me")?.pages.map((p) => p.href) ?? [];
const OPS_PAGES = MODULES.find((m) => m.id === "operations")?.pages.map((p) => p.href) ?? [];
// Day-to-day operations worker: the workspace only (no templates/settings).
const OPS_USER_PAGES = ["/operations/my-work", "/operations/projects"];

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
    description: "Approves pending changes; own creates/edits go in directly. Can download approved Axis Bank salary file.",
    isAdmin: false,
    canApprove: true,
    needsApproval: false,
    pages: [...DEFAULT_NON_ADMIN_PAGES, "/hr/salary"],
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
  {
    name: "HR Manager",
    aliases: ["HR Manager"],
    description: "Manages employees, attendance, leave, salary runs, policies and trainings.",
    isAdmin: false,
    canApprove: true,
    needsApproval: false,
    pages: [...HR_PAGES, ...ME_PAGES],
    isSystem: true,
  },
  {
    name: "HR Executive",
    aliases: ["HR Executive"],
    description: "Day-to-day HR ops; salary run approval still requires HR Manager.",
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    pages: [...HR_PAGES, ...ME_PAGES],
    isSystem: true,
  },
  {
    name: "Employee",
    aliases: ["Employee"],
    description: "Self-service only: leave application, policy ack, training, payslips.",
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    pages: ME_PAGES,
    isSystem: true,
  },
  {
    name: "Operations Manager",
    aliases: ["Operations Manager"],
    description: "Runs the Operations module: authors process templates, assigns projects, sees all candidate projects.",
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    pages: [...OPS_PAGES, ...ME_PAGES],
    isSystem: true,
  },
  {
    name: "Operations User",
    aliases: ["Operations User"],
    description: "Operations team member: works the candidate projects assigned to them (My Work + Projects).",
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    pages: [...OPS_USER_PAGES, ...ME_PAGES],
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
