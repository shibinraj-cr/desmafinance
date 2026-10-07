import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage, type Permissions } from "@/lib/rbac";
import { forbidden, unauthorized } from "@/lib/http-error";

/**
 * Who may do what with bank statements, expressed in DesGro's existing RBAC —
 * a page grant plus the role's capability flags — rather than a parallel
 * permission system:
 *
 *   finance.bank_statements.view        → Role.pages grants /finance/bank-statements
 *   finance.bank_statements.download    → same as view (the original PDFs)
 *   finance.bank_transactions.reconcile → view + a role that posts without approval
 *                                         (canApprove, or needsApproval off)
 *   finance.bank_statements.manage /
 *   finance.bank_automation.manage      → view + canApprove (Finance Admin / Manager),
 *                                         or Admin
 *
 * Admins pass everything (canSeePage). Employees without the page grant get
 * nothing — the page redirects and every API answers 403.
 */

import { BANK_PAGE } from "./constants";

export { BANK_PAGE };

export type BankCaps = { view: boolean; download: boolean; reconcile: boolean; manage: boolean };

export function bankCaps(p: Permissions | null | undefined): BankCaps {
  if (!p) return { view: false, download: false, reconcile: false, manage: false };
  const view = canSeePage(p, BANK_PAGE);
  return {
    view,
    download: view,
    reconcile: view && (p.isAdmin || p.canApprove || !p.needsApproval),
    manage: view && (p.isAdmin || p.canApprove),
  };
}

export async function requireBank(cap: keyof BankCaps): Promise<{ userId: string; caps: BankCaps }> {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const caps = bankCaps(perms);
  if (!caps[cap]) throw forbidden();
  return { userId, caps };
}
