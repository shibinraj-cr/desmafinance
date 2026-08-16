/**
 * Which approved WhatsApp templates a given consultant may send.
 *
 * Templates live at Meta and every one of them is visible to the whole WABA, so
 * without this the composer offers a consultant the entire catalogue — including
 * templates written for a different service, a different market, or a campaign
 * they have nothing to do with. Picking the wrong one sends a real message to a
 * real candidate; there is no undo.
 *
 * DEFAULT IS DENY. A template with no grants is admin-only. The alternative —
 * visible until someone restricts it — would mean every newly approved template
 * is world-visible the moment Meta approves it, which is exactly the state this
 * exists to end.
 *
 * Admins bypass the whole thing: they are the ones who assign grants, and being
 * unable to see a template in order to grant it would be circular.
 */
import { prisma } from "../prisma";
import type { CrmAccess } from "../crm-rbac";

/** `name:language` — the key a grant names and the composer sends. */
export function templateKey(name: string, language: string): string {
  return `${name}:${language}`;
}

export type TemplateGrant = { templateKey: string; userId: string | null; leadPulseRole: string | null };

/**
 * The set of template keys this user may send.
 *
 * Pure so the rule is testable without a database — it is a permission check,
 * and permission checks that can only be verified by clicking are the ones that
 * quietly go wrong.
 */
export function allowedTemplateKeys(
  grants: readonly TemplateGrant[],
  user: { userId: string; leadPulseRole: string | null },
): Set<string> {
  const allowed = new Set<string>();
  for (const g of grants) {
    if (g.userId && g.userId === user.userId) allowed.add(g.templateKey);
    else if (g.leadPulseRole && g.leadPulseRole === user.leadPulseRole) allowed.add(g.templateKey);
  }
  return allowed;
}

/**
 * Filter a template list to what this user may send.
 *
 * Admins get everything; everyone else gets only what has been granted, whether
 * to them personally or to their role tier.
 */
export function filterTemplatesFor<T extends { name: string; language: string }>(
  templates: readonly T[],
  access: Pick<CrmAccess, "isAdmin" | "userId">,
  grants: readonly TemplateGrant[],
  leadPulseRole: string | null,
): T[] {
  if (access.isAdmin) return [...templates];
  const allowed = allowedTemplateKeys(grants, { userId: access.userId, leadPulseRole });
  return templates.filter((t) => allowed.has(templateKey(t.name, t.language)));
}

/** Every grant, for the admin screen and for filtering. Small table; read whole. */
export async function loadTemplateGrants(): Promise<TemplateGrant[]> {
  return prisma.waTemplateGrant.findMany({
    select: { templateKey: true, userId: true, leadPulseRole: true },
  });
}

/**
 * The signed-in user's Lead Pulse tier, which a grant can name instead of them.
 * Null for anyone without one — they can then only be granted personally.
 */
export async function leadPulseRoleOf(userId: string): Promise<string | null> {
  const role = await prisma.leadPulseRole
    .findUnique({ where: { userId }, select: { role: true, active: true } })
    .catch(() => null);
  return role?.active ? role.role : null;
}
