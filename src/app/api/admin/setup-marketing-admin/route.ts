import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { MODULES } from "@/lib/modules";

export const dynamic = "force-dynamic";

/**
 * Admin-only one-shot setup for the "Marketing Admin" role and its
 * link to Suhaina. Three things in one click:
 *
 *   1. Upserts a "Marketing Admin" Role record whose `pages` array
 *      covers every active Marketing module page plus the cross-
 *      module Sources + Parties masters (Marketing routinely needs
 *      to add a lead source or candidate without admin help).
 *      `isAdmin: false` so they never see Finance / Master Data /
 *      System modules; `canApprove: false`, `needsApproval: false`.
 *   2. Assigns Suhaina's user row to that role (matched by
 *      username = "suhaina", case-insensitive).
 *   3. Upserts Suhaina's LeadPulseRole to `role = "supervisor"` so
 *      she lands on the Lead Pulse supervisor dashboard instead of
 *      being redirected to her own Daily Entry form. (Supervisors
 *      don't submit entries themselves — that matches the marketing-
 *      admin job description.)
 *
 * Idempotent — re-runs adjust the role's page list if MODULES has
 * grown and re-affirm Suhaina's assignment.
 */
export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  const marketing = MODULES.find((m) => m.id === "marketing");
  if (!marketing) {
    return NextResponse.json(
      { error: "no_marketing_module", message: "Marketing module missing from registry." },
      { status: 500 },
    );
  }

  // Marketing pages + the cross-module masters a marketing admin
  // legitimately needs (Sources is open to all auth users already;
  // Parties is required for editing candidates).
  const pages = [
    ...marketing.pages.map((p) => p.href),
    "/master-data/sources",
    "/master-data/parties",
    // CRM Meta reconciliation tool (upload Meta export → find leads missing from
    // the CRM). Granted to Marketing Admin without the rest of CRM admin.
    "/crm/meta-reconcile",
  ];

  const role = await prisma.role.upsert({
    where: { name: "Marketing Admin" },
    create: {
      name: "Marketing Admin",
      description:
        "Full access to the Marketing module (Lead Pulse + Candidates & Vendors). No Finance, Master Data admin, or System pages.",
      isAdmin: false,
      canApprove: false,
      needsApproval: false,
      pages,
      isSystem: false,
    },
    update: {
      pages,
      // Don't overwrite a renamed description if the admin tweaked it.
    },
  });

  const log: string[] = [`Role "${role.name}" ready (${pages.length} pages)`];

  // Find Suhaina by username (case-insensitive). The historical import
  // landed her as `suhaina` (lowercase, no dot).
  const suhaina = await prisma.user.findFirst({
    where: { username: { equals: "suhaina", mode: "insensitive" } },
    select: { id: true, username: true, email: true, roleId: true },
  });

  let suhainaAssigned = false;
  let leadPulseUpgraded = false;

  if (suhaina) {
    if (suhaina.roleId !== role.id) {
      await prisma.user.update({
        where: { id: suhaina.id },
        data: { roleId: role.id },
      });
      suhainaAssigned = true;
      log.push(`Assigned ${suhaina.username} → ${role.name}`);
    } else {
      log.push(`${suhaina.username} already linked to ${role.name}`);
    }

    // Bump her Lead Pulse role to supervisor so she lands on the
    // dashboard rather than being redirected to Daily Entry.
    const lp = await prisma.leadPulseRole.findUnique({
      where: { userId: suhaina.id },
    });
    if (!lp) {
      await prisma.leadPulseRole.create({
        data: {
          userId: suhaina.id,
          role: "supervisor",
          displayName: "Suhaina",
          regionFocus: [],
          active: true,
        },
      });
      leadPulseUpgraded = true;
      log.push(`Created LeadPulseRole supervisor for ${suhaina.username}`);
    } else if (lp.role !== "supervisor") {
      await prisma.leadPulseRole.update({
        where: { userId: suhaina.id },
        data: { role: "supervisor" },
      });
      leadPulseUpgraded = true;
      log.push(`Upgraded LeadPulseRole from ${lp.role} → supervisor`);
    } else {
      log.push(`${suhaina.username} already LeadPulseRole supervisor`);
    }
  } else {
    log.push(
      `! User 'suhaina' not found — role exists, link manually via /users when ready`,
    );
  }

  await recordAudit({
    entityType: "Role",
    entityId: role.id,
    action: "UPDATE",
    userId,
    changes: {
      kind: "setup_marketing_admin",
      roleId: role.id,
      pageCount: pages.length,
      suhainaAssigned,
      leadPulseUpgraded,
    },
  });

  return NextResponse.json({
    ok: true,
    summary: {
      roleId: role.id,
      roleName: role.name,
      pages: pages.length,
      suhainaFound: !!suhaina,
      suhainaAssigned,
      leadPulseUpgraded,
    },
    log,
    note: suhaina
      ? "Suhaina must sign out and back in for her JWT to pick up the new role."
      : "User 'suhaina' wasn't found — create her first or link manually via /users.",
  });
}
