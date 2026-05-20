import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { prisma } from "./prisma";
import { fromLegacyString, type Permissions } from "./rbac";

/**
 * Resolve the active session into a `Permissions` record. Prefers the linked
 * `Role` (so custom roles work), falls back to the legacy string `role`
 * column on User for accounts that haven't been migrated yet.
 *
 * Returns null when there's no active session.
 */
export async function getCurrentUserPermissions(): Promise<Permissions | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { roleRef: true },
  });
  if (!user) return null;
  if (user.roleRef) {
    return {
      isAdmin: user.roleRef.isAdmin,
      canApprove: user.roleRef.canApprove,
      needsApproval: user.roleRef.needsApproval,
      draftFirst: user.draftFirst,
      pages: user.roleRef.pages,
      roleName: user.roleRef.name,
    };
  }
  const legacy = fromLegacyString(user.role);
  return { ...legacy, draftFirst: user.draftFirst };
}

export async function getCurrentUserAndPermissions() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { session: null, perms: null, userId: null };
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { roleRef: true },
  });
  if (!user) return { session, perms: null, userId: session.user.id };
  const perms: Permissions = user.roleRef
    ? {
        isAdmin: user.roleRef.isAdmin,
        canApprove: user.roleRef.canApprove,
        needsApproval: user.roleRef.needsApproval,
        draftFirst: user.draftFirst,
        pages: user.roleRef.pages,
        roleName: user.roleRef.name,
      }
    : { ...fromLegacyString(user.role), draftFirst: user.draftFirst };
  return { session, perms, userId: user.id };
}
