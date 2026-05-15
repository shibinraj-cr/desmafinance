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
  disqualified: number;
};

export type RowError = "outcomes_exceed_received" | "negative" | "non_integer" | null;

/**
 * L1 rules:
 *   - all fields are non-negative integers
 *   - connectedCalls ≤ leadsReceived (can't connect more than you got)
 *   - disqualified + transferredToL2 ≤ leadsReceived (mutually-exclusive
 *     terminal outcomes — but they overlap with connectedCalls because
 *     connectedCalls is a parallel funnel step, not another outcome
 *     bucket. So connectedCalls is NOT summed in here.)
 */
export function validateL1Row(r: L1Row): RowError {
  const vals = [r.leadsReceived, r.connectedCalls, r.disqualified, r.transferredToL2];
  for (const v of vals) {
    if (!Number.isFinite(v)) return "non_integer";
    if (!Number.isInteger(v)) return "non_integer";
    if (v < 0) return "negative";
  }
  if (r.connectedCalls > r.leadsReceived) return "outcomes_exceed_received";
  if (r.disqualified + r.transferredToL2 > r.leadsReceived) {
    return "outcomes_exceed_received";
  }
  return null;
}

/**
 * L2 rules:
 *   - all fields are non-negative integers
 *   - connected ≤ totalIn and quoteSent ≤ totalIn (funnel steps, not
 *     exclusive outcomes — they overlap with the close columns).
 *   - closedWon + closedLost ≤ totalIn (mutually-exclusive outcomes).
 *   where totalIn = receivedFromL1 + directLeads.
 */
export function validateL2Row(r: L2Row): RowError {
  const vals = [
    r.receivedFromL1,
    r.directLeads,
    r.connected,
    r.quoteSent,
    r.closedWon,
    r.closedLost,
    r.disqualified,
  ];
  for (const v of vals) {
    if (!Number.isFinite(v)) return "non_integer";
    if (!Number.isInteger(v)) return "non_integer";
    if (v < 0) return "negative";
  }
  const totalIn = r.receivedFromL1 + r.directLeads;
  if (r.connected > totalIn) return "outcomes_exceed_received";
  if (r.quoteSent > totalIn) return "outcomes_exceed_received";
  // closed-won, closed-lost and disqualified are terminal, mutually
  // exclusive outcomes — a single lead lands in one bucket.
  if (r.closedWon + r.closedLost + r.disqualified > totalIn) {
    return "outcomes_exceed_received";
  }
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
