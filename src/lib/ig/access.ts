/**
 * Who may read a lead's Instagram DMs.
 *
 * The same line the WhatsApp thread draws (src/lib/wa/access.ts): a lead is
 * visible across the CRM, but a conversation is the candidate's own words, so
 * it is shown to oversight roles and to the consultant who owns the lead — not
 * to every colleague who can open the record. Leads-only users see neither.
 */
import type { CrmAccess } from "../crm-rbac";
import { isCrmLeadsOnly } from "../rbac";
import { canViewAllConversations } from "../wa/access";

export function canSeeLeadInstagram(
  access: CrmAccess,
  perms: Parameters<typeof isCrmLeadsOnly>[0],
  lead: { assignedToId: string | null },
  userId: string,
): boolean {
  if (isCrmLeadsOnly(perms)) return false;
  return canViewAllConversations(access) || lead.assignedToId === userId;
}
