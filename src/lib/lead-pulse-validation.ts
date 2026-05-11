/**
 * Pure validators for the daily-entry rows. Used both by the API (for
 * security) and the form (for instant feedback). Keep these dependency-
 * free so the form can reuse them without pulling Prisma into the
 * client bundle.
 */

export type L1Row = {
  leadsReceived: number;
  connectedCalls: number;
  disqualified: number;
  transferredToL2: number;
};

export type L2Row = {
  receivedFromL1: number;
  directLeads: number;
  connected: number;
  quoteSent: number;
  closedWon: number;
  closedLost: number;
};

export type RowError = "outcomes_exceed_received" | "negative" | "non_integer" | null;

/** L1 rule: connected_calls + disqualified + transferred_to_l2 ≤ leads_received. */
export function validateL1Row(r: L1Row): RowError {
  const vals = [r.leadsReceived, r.connectedCalls, r.disqualified, r.transferredToL2];
  for (const v of vals) {
    if (!Number.isFinite(v)) return "non_integer";
    if (!Number.isInteger(v)) return "non_integer";
    if (v < 0) return "negative";
  }
  if (r.connectedCalls + r.disqualified + r.transferredToL2 > r.leadsReceived) {
    return "outcomes_exceed_received";
  }
  return null;
}

/** L2 rule: connected + quote_sent + closed_won + closed_lost ≤ received_from_l1 + direct_leads. */
export function validateL2Row(r: L2Row): RowError {
  const vals = [
    r.receivedFromL1,
    r.directLeads,
    r.connected,
    r.quoteSent,
    r.closedWon,
    r.closedLost,
  ];
  for (const v of vals) {
    if (!Number.isFinite(v)) return "non_integer";
    if (!Number.isInteger(v)) return "non_integer";
    if (v < 0) return "negative";
  }
  const totalIn = r.receivedFromL1 + r.directLeads;
  const totalOut = r.connected + r.quoteSent + r.closedWon + r.closedLost;
  if (totalOut > totalIn) return "outcomes_exceed_received";
  return null;
}

export function rowErrorLabel(err: RowError, sourceLabel: string): string | null {
  if (err === null) return null;
  if (err === "outcomes_exceed_received") {
    return `Outcomes exceed received leads in '${sourceLabel}'`;
  }
  if (err === "negative") return `Negative numbers not allowed in '${sourceLabel}'`;
  if (err === "non_integer") return `Whole numbers only in '${sourceLabel}'`;
  return null;
}
