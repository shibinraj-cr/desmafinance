import { prisma } from "./prisma";

/**
 * Validate a transaction's counterparty. Every transaction must name exactly
 * one counterparty — a Party (Candidate/Vendor) or an Employee. Centralised so
 * every write path (create / edit / draft / resubmit) enforces the same rule.
 *
 * Rules:
 *  - exactly one of partyId / employeeId is set (a counterparty is mandatory);
 *  - employees may only be the counterparty on Expense transactions
 *    (salary / incentive outflows);
 *  - a chosen party exists, is active, and its txTypes permits this type;
 *  - a chosen employee exists and is active.
 *
 * Returns an error code suitable for an API response, or null when valid.
 */
export async function validateCounterparty(opts: {
  type: string; // "Revenue" | "Expense"
  partyId?: string | null;
  employeeId?: string | null;
}): Promise<string | null> {
  const partyId = opts.partyId || null;
  const employeeId = opts.employeeId || null;

  if (partyId && employeeId) return "counterparty_conflict";
  if (!partyId && !employeeId) return "counterparty_required";

  if (employeeId) {
    if (opts.type !== "Expense") return "employee_expense_only";
    const emp = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, active: true },
    });
    if (!emp || !emp.active) return "employee_not_found";
    return null;
  }

  const party = await prisma.party.findUnique({
    where: { id: partyId! },
    select: { id: true, isActive: true, txTypes: true },
  });
  if (!party || !party.isActive) return "party_not_found";
  if (party.txTypes !== "Both" && party.txTypes !== opts.type) {
    return "party_tx_type_mismatch";
  }
  return null;
}
