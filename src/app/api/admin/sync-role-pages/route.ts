import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { ALL_PAGE_HREFS, MODULES } from "@/lib/modules";

export const dynamic = "force-dynamic";

/**
 * Admin-only one-shot endpoint that re-syncs every Role's `pages`
 * array against the current `MODULES` registry in `src/lib/modules.ts`.
 *
 * Why this exists: `pages` is stored per Role on the DB and seeded
 * once at role creation. When new pages are added to the module
 * registry, existing roles silently miss them and `canSeePage()`
 * hides the new nav entries. This endpoint forward-fills:
 *
 *   - Roles with `isAdmin = true` get `pages = ALL_PAGE_HREFS`
 *     (every page in the registry).
 *   - Non-admin roles keep their existing pages, but any of the
 *     "shared" any-auth-user pages they're missing are appended:
 *       /finance/parties        (Candidates & Vendors mirror)
 *       /finance/parties/[id]   (implicit prefix match)
 *       /finance/sources        (Sources mirror)
 *       /marketing/parties      (Marketing mirror)
 *       /master-data/sources    (Sources management open to all)
 *
 * Idempotent — re-running is a no-op once roles are in sync.
 */
const SHARED_NON_ADMIN_PAGES = [
  "/finance/parties",
  "/marketing/parties",
  "/master-data/sources",
  // BDE-facing Lead Pulse pages so L1/L2 BDEs see them in the sidebar.
  // The pages themselves still gate by LeadPulseRole, so granting them
  // here is harmless for non-BDE non-admin roles (they'd hit the 403
  // page but it's unlikely they navigate there).
  "/marketing/lead-pulse",
  "/marketing/lead-pulse/daily-entry",
  "/marketing/lead-pulse/bde-performance",
];

export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  const log: string[] = [];
  let adminUpdated = 0;
  let nonAdminUpdated = 0;

  const roles = await prisma.role.findMany();
  for (const role of roles) {
    if (role.isAdmin) {
      const before = new Set(role.pages);
      const after = new Set(ALL_PAGE_HREFS);
      const added = ALL_PAGE_HREFS.filter((p) => !before.has(p));
      const removed = role.pages.filter((p) => !after.has(p));
      if (added.length === 0 && removed.length === 0) {
        log.push(`= ${role.name}: already in sync (${role.pages.length} pages)`);
        continue;
      }
      await prisma.role.update({
        where: { id: role.id },
        data: { pages: ALL_PAGE_HREFS },
      });
      adminUpdated++;
      log.push(
        `✓ ${role.name}: +${added.length} pages${
          removed.length ? `, -${removed.length} stale` : ""
        }`,
      );
    } else {
      const existing = new Set(role.pages);
      const missing = SHARED_NON_ADMIN_PAGES.filter((p) => !existing.has(p));
      if (missing.length === 0) {
        log.push(`= ${role.name}: shared pages already present`);
        continue;
      }
      await prisma.role.update({
        where: { id: role.id },
        data: { pages: [...role.pages, ...missing] },
      });
      nonAdminUpdated++;
      log.push(`✓ ${role.name}: +${missing.join(", ")}`);
    }
  }

  await recordAudit({
    entityType: "Role",
    entityId: "__sync_pages__",
    action: "UPDATE",
    userId,
    changes: { kind: "sync_role_pages", adminUpdated, nonAdminUpdated, log },
  });

  return NextResponse.json({
    ok: true,
    summary: {
      rolesScanned: roles.length,
      adminUpdated,
      nonAdminUpdated,
      modulesInRegistry: MODULES.length,
      totalPagesInRegistry: ALL_PAGE_HREFS.length,
    },
    log,
  });
}
