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
 *
 * NB: we deliberately don't compare any outcome column against the
 * day's `leadsReceived` — a BDE's connected/disqualified/transferred
 * counts include follow-up calls on leads received earlier days, so
 * the daily numbers can legitimately exceed the day's new intake.
 * Funnel-integrity checks live at the monthly/aggregate level instead.
 */
export function validateL1Row(r: L1Row): RowError {
  const vals = [r.leadsReceived, r.connectedCalls, r.disqualified, r.transferredToL2];
  for (const v of vals) {
    if (!Number.isFinite(v)) return "non_integer";
    if (!Number.isInteger(v)) return "non_integer";
    if (v < 0) return "negative";
  }
  return null;
}

/**
 * L2 rules:
 *   - all fields are non-negative integers
 *
 * Same rationale as L1 — connected/quoteSent/closedWon/closedLost/
 * disqualified on a given day can include outcomes on leads received
 * earlier (closed-won today on a Meta lead from three weeks ago is
 * common). Upper-bound checks against today's `receivedFromL1 +
 * directLeads` would block valid entries.
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
