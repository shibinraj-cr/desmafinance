import { prisma } from "./prisma";
import { fromLegacyString, type Permissions } from "./rbac";
import { canApproveHr } from "./hr-rbac";

/**
 * Who is allowed to decide whose leave / attendance request.
 *
 * Two rules, both enforced in the API routes. The queue filters on the HR pages
 * mirror them so an approver never sees a request they can't act on, but the
 * filters are a convenience — the route guards are the actual control.
 *
 *   1. NOBODY decides their own request. An HR Manager who is also an employee
 *      must not sign off on their own leave, and must not reach around the
 *      request flow by editing their own attendance day directly.
 *
 *   2. A request from someone who THEMSELVES holds HR approval rights routes to
 *      a single designated approver (the business owner). Without this, two HR
 *      Managers can rubber-stamp each other's leave, which is self-approval
 *      with one extra step — the hole that motivated this module.
 *
 * Everyone else's requests keep routing to the normal HR approver pool.
 */

/**
 * Login identifiers — `username` or `email`, matched case-insensitively — of
 * the owner who signs off on an HR approver's own requests.
 *
 * Deployment can override without a code change by setting
 * `HR_LEAVE_APPROVER` to a comma-separated list of usernames / emails. If
 * NOTHING here resolves to an active user (account renamed, deactivated),
 * `designatedLeaveApproverIds` returns empty and every caller degrades to
 * "any Admin" — never to "any HR approver", so rule 2 holds either way and the
 * queue can't black-hole.
 */
const DESIGNATED_LEAVE_APPROVERS = ["shibin"];

function designatedIdentifiers(): string[] {
  const raw = process.env.HR_LEAVE_APPROVER;
  const list = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : DESIGNATED_LEAVE_APPROVERS;
  return list.map((s) => s.toLowerCase());
}

/** Build the same `Permissions` shape `getCurrentUserAndPermissions` derives, from a user row. */
type UserWithRole = {
  role: string | null;
  draftFirst: boolean;
  roleRef: {
    isAdmin: boolean;
    canApprove: boolean;
    needsApproval: boolean;
    pages: string[];
    name: string;
  } | null;
};

export function permissionsForUser(user: UserWithRole): Permissions {
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
  return { ...fromLegacyString(user.role), draftFirst: user.draftFirst };
}

const USER_WITH_ROLE = {
  role: true,
  draftFirst: true,
  roleRef: {
    select: { isAdmin: true, canApprove: true, needsApproval: true, pages: true, name: true },
  },
} as const;

/**
 * User ids of the designated approver(s), resolved from username/email. Empty
 * when none of the configured identifiers matches an ACTIVE user — callers must
 * treat that as "fall back to Admin", not as "anyone".
 */
export async function designatedLeaveApproverIds(): Promise<string[]> {
  const wanted = designatedIdentifiers();
  if (wanted.length === 0) return [];
  // Case-insensitive match on either column. `username` is stored lowercase by
  // the seed, but a user created through the UI may not be, so don't assume.
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [
        { username: { in: wanted, mode: "insensitive" } },
        { email: { in: wanted, mode: "insensitive" } },
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Employee ids whose own login carries HR approval authority. Their requests
 * are the ones that must route to the designated approver / an Admin.
 *
 * Derived from live role records rather than a stored flag, so granting or
 * revoking HR approval rights re-routes their pending requests immediately.
 */
export async function hrApproverEmployeeIds(): Promise<string[]> {
  const employees = await prisma.employee.findMany({
    where: { userId: { not: null } },
    select: { id: true, user: { select: { isActive: true, ...USER_WITH_ROLE } } },
  });
  return employees
    .filter((e) => e.user?.isActive && canApproveHr(permissionsForUser(e.user)))
    .map((e) => e.id);
}

/** True when `userId` is a designated approver, or (if none resolved) an Admin. */
export async function canApproveHrApproverRequests(
  userId: string | null,
  perms: Permissions | null,
): Promise<boolean> {
  if (!userId) return false;
  const designated = await designatedLeaveApproverIds();
  if (designated.length === 0) return !!perms?.isAdmin;
  return designated.includes(userId);
}

/**
 * The single gate every leave/attendance decision route calls before writing.
 * Returns a human-readable refusal, or null when the decision may proceed.
 *
 * `employeeIds` is every employee the action would touch — one for a single
 * request, many for a bulk attendance decision — so a batch that happens to
 * include the approver's own day is refused as a whole rather than half-applied.
 */
export async function leaveDecisionBlockedReason(opts: {
  approverUserId: string | null;
  perms: Permissions | null;
  employeeIds: string[];
}): Promise<string | null> {
  const { approverUserId, perms, employeeIds } = opts;
  if (employeeIds.length === 0) return null;
  const targets = new Set(employeeIds);

  // Rule 1 — no self-approval. An approver with no linked employee record
  // (e.g. a pure admin login) can never collide here.
  const own = approverUserId
    ? await prisma.employee.findUnique({ where: { userId: approverUserId }, select: { id: true } })
    : null;
  if (own && targets.has(own.id)) {
    return "You can't decide your own attendance or leave — it has to be reviewed by another approver.";
  }

  // Rule 2 — an HR approver's own request goes to the designated approver.
  const approverEmps = await hrApproverEmployeeIds();
  const restricted = approverEmps.filter((id) => targets.has(id));
  if (restricted.length === 0) return null;
  if (await canApproveHrApproverRequests(approverUserId, perms)) return null;
  return restricted.length === 1
    ? "This request is from an HR approver, so only the designated approver can decide it."
    : `${restricted.length} of these days belong to HR approvers, so only the designated approver can decide them.`;
}

/**
 * Prisma `where` fragment scoping an HR review queue to what this approver may
 * actually act on: never their own rows, and — unless they're the designated
 * approver — never another HR approver's.
 */
export async function reviewQueueScope(
  approverUserId: string | null,
  perms: Permissions | null,
): Promise<{ employeeId?: { notIn: string[] } }> {
  const hidden = new Set<string>();
  if (approverUserId) {
    const own = await prisma.employee.findUnique({
      where: { userId: approverUserId },
      select: { id: true },
    });
    if (own) hidden.add(own.id);
  }
  if (!(await canApproveHrApproverRequests(approverUserId, perms))) {
    for (const id of await hrApproverEmployeeIds()) hidden.add(id);
  }
  return hidden.size > 0 ? { employeeId: { notIn: [...hidden] } } : {};
}
