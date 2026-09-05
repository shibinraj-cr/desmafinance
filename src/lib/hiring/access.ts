import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { unauthorized, forbidden } from "@/lib/http-error";
import { resolveHiringAccess, can, type HiringAccess, type HiringPermission } from "./rbac";

/**
 * Load the current user's hiring access. One DB read (their HiringMember row)
 * on top of the session permissions the rest of the app already resolves.
 *
 * Server pages call this and branch; API routes call `requireHiring` so a
 * missing permission is a 403 rather than a silently-empty list.
 */
export async function getHiringAccess(): Promise<{
  userId: string | null;
  access: HiringAccess | null;
}> {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return { userId: null, access: null };
  const member = await prisma.hiringMember.findUnique({
    where: { userId },
    select: {
      baseRole: true,
      customRoleName: true,
      extraPermissions: true,
      deniedPermissions: true,
      isActive: true,
    },
  });
  return { userId, access: resolveHiringAccess(userId, perms, member) };
}

/**
 * API-route guard: 401 when signed out, 403 when the permission is missing.
 * Returns the access object so the handler never re-resolves it.
 */
export async function requireHiring(key: HiringPermission): Promise<HiringAccess> {
  const { access } = await getHiringAccess();
  if (!access) throw unauthorized();
  if (!can(access, key)) throw forbidden();
  return access;
}
