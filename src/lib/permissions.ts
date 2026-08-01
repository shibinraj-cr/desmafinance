import { getServerSession } from "next-auth";
import { decode } from "next-auth/jwt";
import { headers } from "next/headers";
import { authOptions } from "./auth";
import { prisma } from "./prisma";
import { env } from "./env";
import { fromLegacyString, type Permissions } from "./rbac";

/**
 * Mobile bearer fallback: when there's no web session cookie, accept an
 * `Authorization: Bearer <jwt>` header. The token is minted by
 * `/api/auth/mobile-login` with `encode()` using the SAME `NEXTAUTH_SECRET`
 * and `{ uid }` shape as the web cookie, so it decodes here verbatim.
 *
 * SECURITY: this only yields a userId — permissions are ALWAYS re-derived from
 * the DB below (roleRef / isActive), so a forged or stale token claim can never
 * escalate privileges, and a deactivated account loses access immediately.
 */
async function bearerUserId(): Promise<string | null> {
  try {
    const authz = headers().get("authorization");
    if (authz?.startsWith("Bearer ")) {
      const token = await decode({ token: authz.slice(7), secret: env.NEXTAUTH_SECRET });
      if (token?.uid) return String(token.uid);
    }
  } catch {
    // malformed / expired token → treat as unauthenticated
  }
  return null;
}

/**
 * Resolve the active session into a `Permissions` record. Prefers the linked
 * `Role` (so custom roles work), falls back to the legacy string `role`
 * column on User for accounts that haven't been migrated yet.
 *
 * Returns null when there's no active session.
 */
export async function getCurrentUserPermissions(): Promise<Permissions | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? (await bearerUserId());
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleRef: true },
  });
  if (!user) return null;
  // A deactivated account loses access immediately, even mid-session.
  if (!user.isActive) return null;
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
  // Cookie (web) is tried first and unchanged; bearer (mobile) is the fallback.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? (await bearerUserId());
  if (!userId) return { session: null, perms: null, userId: null };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleRef: true },
  });
  if (!user) return { session, perms: null, userId };
  // A deactivated account loses access immediately, even mid-session.
  if (!user.isActive) return { session, perms: null, userId: user.id };
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
