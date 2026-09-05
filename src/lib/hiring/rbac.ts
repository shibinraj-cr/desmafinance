import type { Permissions } from "@/lib/rbac";
import { isAdmin, canSeePage } from "@/lib/rbac";

/**
 * Hiring-module access control.
 *
 * The spec this module was built from assumed Supabase RLS. Desgro has no
 * Supabase and no row-level security — every other module (CRM, Operations,
 * Lead Pulse) resolves capabilities in an `*-rbac.ts` module that the page AND
 * the API route both call, and correctness comes from there being exactly one
 * such resolver. Hiring follows that pattern rather than inventing a second
 * enforcement mechanism:
 *
 *   - a single `HiringAccess` object, derived once per request,
 *   - a `can()` check on named permission keys (§6 of the spec),
 *   - and, for the partner boundary, a query-scoping helper in
 *     `src/lib/hiring/partner-scope.ts` that every partner-facing query must go
 *     through. That boundary is covered by tests that fail by default.
 *
 * Where a role comes from, in order of precedence:
 *   1. System admin (`Permissions.isAdmin`)              → owner
 *   2. A `HiringMember` row pinned to this user          → its baseRole
 *   3. Page grants on the user's Desgro role             → hr_manager / recruiter / employee
 *
 * (3) is what makes this feel native: granting a role `/hiring/settings` mints
 * a hiring HR manager with no code change, exactly like `/crm/settings` mints a
 * CRM admin. (2) exists because hiring needs distinctions — "this person is an
 * employee who may only refer" — that page grants alone cannot express.
 */

/** Fine-grained permission keys (§6). */
export const HIRING_PERMISSIONS = [
  "job:read",
  "job:write",
  "candidate:read",
  "candidate:write",
  "candidate:move",
  "interview:manage",
  "offer:manage",
  "referral:manage",
  "sourcing:manage",
  "submission:write",
  "automation:manage",
  "analytics:read",
  "apikey:manage",
  "team:manage",
  "self:read",
  "self:write",
] as const;

export type HiringPermission = (typeof HIRING_PERMISSIONS)[number];

/** Base roles. `partner` is an EXTERNAL identity — never a Desgro User. */
export type HiringBaseRole = "owner" | "hr_manager" | "recruiter" | "partner" | "employee";

const ALL: HiringPermission[] = [...HIRING_PERMISSIONS];

/**
 * Base role → permission keys. A custom role is a base role plus
 * `extraPermissions` minus `deniedPermissions` on the HiringMember row.
 */
export const ROLE_PERMISSIONS: Record<HiringBaseRole, HiringPermission[]> = {
  // Everything, including workspace-level settings.
  owner: ALL,
  // Everything but billing / workspace deletion — neither of which exists as a
  // permission key, so in practice an HR manager holds the full set.
  hr_manager: ALL,
  // Jobs, candidates and interviews — but NOT offers (money) and NOT partner
  // fees (money), per §6.
  recruiter: [
    "job:read",
    "job:write",
    "candidate:read",
    "candidate:write",
    "candidate:move",
    "interview:manage",
    "referral:manage",
    "analytics:read",
    "self:read",
    "self:write",
  ],
  // External agency. Scoped to granted jobs and their OWN submissions — the
  // scoping itself is enforced in partner-scope.ts, not by this key list.
  partner: ["job:read", "submission:write", "self:read", "self:write"],
  // A DESMA staffer who is not part of the hiring team: refer someone, and
  // read/write their own profile. Nothing else.
  employee: ["referral:manage", "self:read", "self:write"],
};

/** Human labels for the settings permission matrix. */
export const ROLE_LABELS: Record<HiringBaseRole, string> = {
  owner: "Owner",
  hr_manager: "HR Manager",
  recruiter: "Recruiter — internal",
  partner: "Sourcing partner — external",
  employee: "Employee",
};

/**
 * Granting a Desgro role this page promotes it to the hiring HR-manager tier —
 * the same trick as `/crm/settings` and `/operations/settings`.
 */
export const HIRING_SETTINGS_PAGE = "/hiring/settings";

/** Any of these page grants marks a role as an internal recruiter. */
export const HIRING_RECRUITER_ANCHORS = [
  "/hiring/pipeline",
  "/hiring/jobs",
  "/hiring/candidates",
  "/hiring/follow-ups",
  "/hiring/interviews",
];

/** The employee-facing surface — enough on its own to make someone a referrer. */
export const HIRING_REFERRALS_PAGE = "/hiring/referrals";

/** The stored side of a member record, or null when the user has no row. */
export type HiringMemberLike = {
  baseRole: string;
  customRoleName: string | null;
  extraPermissions: string[];
  deniedPermissions: string[];
  isActive: boolean;
} | null;

export type HiringAccess = {
  userId: string;
  isAdmin: boolean;
  baseRole: HiringBaseRole;
  /** Display name — the custom role name when one is set, else the base label. */
  roleLabel: string;
  /** Effective keys after extra/denied overrides. */
  permissions: HiringPermission[];
  /** True for anyone who may open the hiring section at all. */
  isHiringUser: boolean;
};

function isPermission(k: string): k is HiringPermission {
  return (HIRING_PERMISSIONS as readonly string[]).includes(k);
}

/**
 * Pure resolver — no DB, so it is cheap to call on every request and trivially
 * testable. `member` is the user's HiringMember row (or null).
 */
export function resolveHiringAccess(
  userId: string,
  perms: Permissions | null,
  member: HiringMemberLike,
): HiringAccess {
  const admin = isAdmin(perms ?? null);

  let baseRole: HiringBaseRole;
  if (admin) {
    baseRole = "owner";
  } else if (member && member.isActive && isBaseRole(member.baseRole)) {
    baseRole = member.baseRole;
  } else if (perms && canSeePage(perms, HIRING_SETTINGS_PAGE)) {
    baseRole = "hr_manager";
  } else if (perms && HIRING_RECRUITER_ANCHORS.some((p) => canSeePage(perms, p))) {
    baseRole = "recruiter";
  } else {
    baseRole = "employee";
  }

  // Deny wins over grant, and an inactive member gets nothing beyond the
  // page-grant floor (their row is ignored above, so this only trims).
  const denied = new Set((member?.deniedPermissions ?? []).filter(isPermission));
  const granted = new Set<HiringPermission>(ROLE_PERMISSIONS[baseRole]);
  if (member?.isActive) {
    for (const k of member.extraPermissions) if (isPermission(k)) granted.add(k);
  }
  const permissions = [...granted].filter((k) => !denied.has(k));

  // An employee with only self:*/referral:manage still legitimately opens
  // /hiring/referrals, so "hiring user" is broader than "hiring team".
  const isHiringUser =
    admin ||
    baseRole !== "employee" ||
    (perms ? canSeePage(perms, HIRING_REFERRALS_PAGE) : false);

  return {
    userId,
    isAdmin: admin,
    baseRole,
    roleLabel: member?.customRoleName?.trim() || ROLE_LABELS[baseRole],
    permissions,
    isHiringUser,
  };
}

function isBaseRole(r: string): r is HiringBaseRole {
  return r === "owner" || r === "hr_manager" || r === "recruiter" || r === "partner" || r === "employee";
}

/** The one permission check. Use it in the page AND the API route. */
export function can(access: HiringAccess | null, key: HiringPermission): boolean {
  return !!access && access.permissions.includes(key);
}

/**
 * §6: "hiring manager" is DERIVED, not a stored role — whoever is named on a
 * req may review its candidates and submit scorecards whatever their base role.
 * This is additive: it never removes a permission someone already holds.
 */
export function canReviewJob(
  access: HiringAccess | null,
  job: { ownerId: string | null; hiringManagerId: string | null } | null,
): boolean {
  if (!access || !job) return false;
  if (can(access, "candidate:read")) return true;
  return job.hiringManagerId === access.userId || job.ownerId === access.userId;
}

/** Same derivation, for submitting a scorecard on a req you are named on. */
export function canScoreJob(
  access: HiringAccess | null,
  job: { ownerId: string | null; hiringManagerId: string | null } | null,
): boolean {
  return can(access, "interview:manage") || canReviewJob(access, job);
}
