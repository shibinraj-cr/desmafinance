import { getServerSession, type Session } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "./auth";
import { prisma } from "./prisma";
import { readAppToken, isCurrentMobileSession } from "./mobile-session";
import { fromLegacyString, type Permissions } from "./rbac";
import { PC_ENROLL_PAGE } from "./partner-commissions/constants";

/**
 * What the loader reads beyond the role, for per-PERSON page grants that a
 * shared Role can't express.
 */
const USER_INCLUDE = {
  roleRef: true,
  leadPulseRole: { select: { role: true, active: true } },
  pcEnrollGrant: { select: { programs: true } },
} as const;

/**
 * Partner Enrollments (/crm/partner-enrollments) is granted per person, not per
 * role: every active BDE (Lead Pulse L1/L2 — they enroll GCAN) and anyone with a
 * personal enrollment grant from the Partner Commissions settings (e.g. the
 * OSCE/NCLEX coordinator). Adding it here makes the nav and canSeePage agree
 * without touching any Role row. The page re-checks exactly which programs.
 */
function withPersonalPages(
  pages: string[],
  user: {
    leadPulseRole: { role: string; active: boolean } | null;
    pcEnrollGrant: { programs: string[] } | null;
  },
): string[] {
  const bde = !!user.leadPulseRole?.active && (user.leadPulseRole.role === "l1" || user.leadPulseRole.role === "l2");
  const granted = (user.pcEnrollGrant?.programs.length ?? 0) > 0;
  if ((bde || granted) && !pages.includes(PC_ENROLL_PAGE)) return [...pages, PC_ENROLL_PAGE];
  return pages;
}

/**
 * Mobile bearer fallback: when there's no web session cookie, accept an
 * `Authorization: Bearer <jwt>` header. The token is minted by
 * `/api/auth/mobile-login` with `encode()` using the SAME `NEXTAUTH_SECRET`
 * and `{ uid }` shape as the web cookie, so it decodes here verbatim.
 *
 * SECURITY: this only yields a userId — permissions are ALWAYS re-derived from
 * the DB below (roleRef / isActive), so a forged or stale token claim can never
 * escalate privileges, and a deactivated account loses access immediately.
 * The token's `sid` is checked there too: one signed-in phone per user
 * (src/lib/mobile-session.ts).
 */
async function bearerToken(): Promise<{ uid: string; sid: string | null } | null> {
  try {
    return await readAppToken(headers().get("authorization"));
  } catch {
    // outside a request → unauthenticated
    return null;
  }
}

/** The signed-in user's id: the web cookie first, else the app's bearer token. */
async function resolveUserId(): Promise<{
  session: Session | null;
  userId: string | null;
  bearerSid: string | null | undefined;
}> {
  const session = await getServerSession(authOptions);
  if (session?.user?.id) return { session, userId: session.user.id, bearerSid: undefined };
  const bearer = await bearerToken();
  return { session, userId: bearer?.uid ?? null, bearerSid: bearer ? bearer.sid : undefined };
}

/** False for an app token superseded by a newer app sign-in; web sessions always pass. */
function appSessionOk(user: { mobileSessionId: string | null }, bearerSid: string | null | undefined): boolean {
  return bearerSid === undefined || isCurrentMobileSession(user.mobileSessionId, bearerSid);
}

/**
 * Resolve the active session into a `Permissions` record. Prefers the linked
 * `Role` (so custom roles work), falls back to the legacy string `role`
 * column on User for accounts that haven't been migrated yet.
 *
 * Returns null when there's no active session.
 */
export async function getCurrentUserPermissions(): Promise<Permissions | null> {
  const { userId, bearerSid } = await resolveUserId();
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: USER_INCLUDE,
  });
  if (!user) return null;
  // Signed in on another phone since this token was issued.
  if (!appSessionOk(user, bearerSid)) return null;
  // A deactivated account loses access immediately, even mid-session.
  if (!user.isActive) return null;
  if (user.roleRef) {
    return {
      isAdmin: user.roleRef.isAdmin,
      canApprove: user.roleRef.canApprove,
      needsApproval: user.roleRef.needsApproval,
      draftFirst: user.draftFirst,
      pages: withPersonalPages(user.roleRef.pages, user),
      roleName: user.roleRef.name,
    };
  }
  const legacy = fromLegacyString(user.role);
  return { ...legacy, pages: withPersonalPages(legacy.pages, user), draftFirst: user.draftFirst };
}

export async function getCurrentUserAndPermissions() {
  // Cookie (web) is tried first and unchanged; bearer (mobile) is the fallback.
  const { session, userId, bearerSid } = await resolveUserId();
  if (!userId) return { session: null, perms: null, userId: null };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: USER_INCLUDE,
  });
  if (!user) return { session, perms: null, userId };
  // Signed in on another phone since this token was issued: unauthenticated (401).
  if (!appSessionOk(user, bearerSid)) return { session: null, perms: null, userId: null };
  // A deactivated account loses access immediately, even mid-session.
  if (!user.isActive) return { session, perms: null, userId: user.id };
  const legacy = user.roleRef ? null : fromLegacyString(user.role);
  const perms: Permissions = user.roleRef
    ? {
        isAdmin: user.roleRef.isAdmin,
        canApprove: user.roleRef.canApprove,
        needsApproval: user.roleRef.needsApproval,
        draftFirst: user.draftFirst,
        pages: withPersonalPages(user.roleRef.pages, user),
        roleName: user.roleRef.name,
      }
    : { ...legacy!, pages: withPersonalPages(legacy!.pages, user), draftFirst: user.draftFirst };
  return { session, perms, userId: user.id };
}
