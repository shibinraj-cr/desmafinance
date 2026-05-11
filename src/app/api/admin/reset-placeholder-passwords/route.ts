import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Admin-only one-shot endpoint that resets every placeholder user
 * (those auto-created by `lead-pulse-import-historical` with an
 * `@desfin.local` email) to a known temporary password so the admin
 * can hand out credentials. Idempotent — re-runs reset to the same
 * temp value.
 *
 * The plaintext temp password is returned in the response payload so
 * the admin can distribute it; nothing about it is stored in the DB.
 */
const TEMP_PASSWORD = "Welcome@2026!";
const PLACEHOLDER_DOMAIN = "@desfin.local";

export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  const placeholders = await prisma.user.findMany({
    where: { email: { endsWith: PLACEHOLDER_DOMAIN } },
    select: { id: true, username: true, email: true },
    orderBy: { username: "asc" },
  });

  if (placeholders.length === 0) {
    return NextResponse.json({
      ok: true,
      tempPassword: TEMP_PASSWORD,
      users: [],
      note: "No placeholder users (@desfin.local) found — nothing to reset.",
    });
  }

  // Hash once; same hash reused for everyone (cost 12 takes ~150ms,
  // doing it 19× would needlessly inflate latency).
  const hash = await bcrypt.hash(TEMP_PASSWORD, 12);
  await prisma.user.updateMany({
    where: { id: { in: placeholders.map((u) => u.id) } },
    data: { passwordHash: hash },
  });

  // Audit log — one row, includes the list of usernames touched.
  await recordAudit({
    entityType: "User",
    entityId: "__placeholder_password_reset__",
    action: "UPDATE",
    userId,
    changes: {
      kind: "bulk_placeholder_password_reset",
      tempPasswordLength: TEMP_PASSWORD.length,
      usernames: placeholders.map((u) => u.username),
    },
  });

  return NextResponse.json({
    ok: true,
    tempPassword: TEMP_PASSWORD,
    users: placeholders.map((u) => ({
      username: u.username,
      email: u.email,
    })),
  });
}
