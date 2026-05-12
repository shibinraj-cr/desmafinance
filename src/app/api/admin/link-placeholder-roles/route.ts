import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Admin-only one-shot endpoint that links the historical-import
 * placeholder users (those with `@desfin.local` email) to the
 * Finance Executive `Role` record. Without this, their perms fall
 * through to the hardcoded `fromLegacyString("user")` fallback in
 * src/lib/rbac.ts, which only grants Finance pages — so the Lead
 * Pulse nav entries the Sync-role-pages button added never reach
 * them.
 *
 * Idempotent — re-runs skip users already linked.
 *
 * Role resolution: prefer "Finance Executive" by name; fall back to
 * the alias "Executive"; fall back to any non-admin role with the
 * executive permission signature (canApprove=false, needsApproval=
 * true). This survives admins renaming the role in the UI.
 */
export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  const execRole =
    (await prisma.role.findUnique({ where: { name: "Finance Executive" } })) ??
    (await prisma.role.findUnique({ where: { name: "Executive" } })) ??
    (await prisma.role.findFirst({
      where: { isAdmin: false, canApprove: false, needsApproval: true },
    }));

  if (!execRole) {
    return NextResponse.json(
      {
        error: "no_executive_role",
        message: "Couldn't find a Finance Executive role to link users to. Re-run db:seed-roles first.",
      },
      { status: 500 },
    );
  }

  const placeholders = await prisma.user.findMany({
    where: {
      email: { endsWith: "@desfin.local" },
      roleId: null,
    },
    select: { id: true, username: true, email: true },
    orderBy: { username: "asc" },
  });

  if (placeholders.length === 0) {
    return NextResponse.json({
      ok: true,
      summary: { linked: 0, alreadyLinked: 0, role: execRole.name, roleId: execRole.id },
      log: [],
      note: "All placeholder users are already linked (or none exist).",
    });
  }

  await prisma.user.updateMany({
    where: { id: { in: placeholders.map((u) => u.id) } },
    data: { roleId: execRole.id },
  });

  await recordAudit({
    entityType: "User",
    entityId: "__placeholder_role_link__",
    action: "UPDATE",
    userId,
    changes: {
      kind: "link_placeholders_to_finance_executive",
      roleId: execRole.id,
      roleName: execRole.name,
      usernames: placeholders.map((u) => u.username),
    },
  });

  return NextResponse.json({
    ok: true,
    summary: {
      linked: placeholders.length,
      role: execRole.name,
      roleId: execRole.id,
    },
    log: placeholders.map((u) => `✓ ${u.username} → ${execRole.name}`),
    note: "Each linked user must sign out and back in before their JWT picks up the new pages.",
  });
}
