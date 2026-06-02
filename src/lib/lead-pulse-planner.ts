/**
 * Lead Pulse Growth Planner — pure deterministic engine.
 *
 * Works *backwards* from a closed-won (enrollment) target through the team's
 * historic funnel rates to compute the leads required at each stage and the
 * L1 / L2 BDE headcount needed to deliver it.
 *
 * This module has NO Prisma / DB / network imports on purpose: it runs both
 * server-side (API routes) and in the browser (the interactive simulator
 * re-runs `computePlan` on every slider change). All historic numbers come in
 * as parameters via `getPlannerBaseline` in lead-pulse-metrics.ts. The LLM
 * layer never produces these numbers — it consumes this output as ground truth.
 *
 * Conventions mirror lead-pulse-metrics.ts: percentages are 0–100 numbers,
 * counts are whole numbers.
 */

/** Historic conversion rates (all 0–100). Drives the back-calculation. */
export type PlannerRates = {
  /** transferredToL2 / l1Leads — L1 hand-off efficiency. */
  l1ToTransferPct: number;
  /** closedWon / l2Leads — L2 closing efficiency. */
  l2ConvPct: number;
  /** receivedFromL1 / l2Leads — share of L2 leads that originate from L1. */
  fromL1SharePct: number;
  /** (l1.connectedCalls + l2.connected) / totalLeads — for the funnel viz only. */
  connectedPct: number;
};

/** Per-head monthly throughput, derived from history (held constant). */
export type PlannerCapacity = {
  /** Avg leadsReceived handled per active L1 BDE / month. */
  leadsPerActiveL1: number;
  /** Avg closedWon delivered per active L2 BDE / month. */
  closesPerActiveL2: number;
};

/** Current active roster, for gap (hire/free) calculation. */
export type PlannerRoster = { activeL1: number; activeL2: number };

/**
 * Meta-budget lever (blended). Meta is the controllable paid source. The plan
 * sizes its budget off the qualified (L2) leads the target requires, valued at
 * the blended cost-per-qualified-lead (total Meta spend ÷ all L2 leads). No
 * source-mix split: every required qualified lead is costed at the blended rate.
 */
export type PlannerMetaInput = {
  /** Blended ₹ per qualified (L2) lead = Meta spend ÷ qualified leads; null when unknown. */
  costPerQualifiedLead: number | null;
  /** Current qualified (L2) leads / month (for comparison). */
  currentQualifiedLeadsPerMonth: number;
  /** Current Meta spend / month, ₹ (for comparison). */
  currentSpendPerMonth: number;
};

export type PlannerInputs = {
  targetClosedWon: number;
  rates: PlannerRates;
  capacity: PlannerCapacity;
  roster: PlannerRoster;
  meta?: PlannerMetaInput;
};

export type PlannerStage = {
  key: "leads" | "connected" | "won";
  label: string;
  value: number;
};

export type PlannerMetaOutput = {
  /** Qualified (L2) leads/month the target requires (= requiredL2Leads). */
  requiredQualifiedLeadsPerMonth: number;
  /** ₹/month Meta ad budget = required qualified leads × cost-per-qualified-lead; null when cost unknown. */
  requiredBudgetPerMonth: number | null;
  /** Blended ₹ per qualified (L2) lead. */
  costPerQualifiedLead: number | null;
  currentQualifiedLeadsPerMonth: number;
  currentSpendPerMonth: number;
  /** requiredBudget − currentSpend; null when budget unknown. */
  budgetDeltaPerMonth: number | null;
};

export type PlannerOutput = {
  /** Target echoed back (clamped to ≥ 0, integer). */
  target: number;
  /** False when a required rate is ≤ 0 so the chain can't be solved. */
  feasible: boolean;
  requiredL2Leads: number;
  requiredFromL1: number;
  requiredDirect: number;
  requiredL1Leads: number;
  requiredTotalLeads: number;
  requiredL1Bdes: number;
  requiredL2Bdes: number;
  /** required − current. Positive ⇒ must hire; negative ⇒ headroom. */
  l1Gap: number;
  l2Gap: number;
  /** Reverse funnel, top→bottom: leads → connected → won. */
  stages: PlannerStage[];
  /** Meta-budget plan, or null when no Meta lever was supplied. */
  meta: PlannerMetaOutput | null;
  /** Human-readable notes about clamped/zero rates. */
  warnings: string[];
};

/** Clamp a 0–100 rate, tolerating junk (NaN → 0). */
function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function nonNegInt(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v);
}

/**
 * Back-calculate the lead + headcount plan from a closed-won target.
 *
 *   requiredL2Leads    = ceil(T / l2Conv)
 *   requiredFromL1     = requiredL2Leads × fromL1Share
 *   requiredDirect     = requiredL2Leads − requiredFromL1
 *   requiredL1Leads    = ceil(requiredFromL1 / l1ToTransfer)
 *   requiredTotalLeads = requiredL1Leads + requiredDirect
 *   requiredL1Bdes     = ceil(requiredL1Leads / leadsPerActiveL1)
 *   requiredL2Bdes     = ceil(T / closesPerActiveL2)
 */
export function computePlan(inputs: PlannerInputs): PlannerOutput {
  const target = nonNegInt(inputs.targetClosedWon);
  const warnings: string[] = [];

  const l1ToTransfer = clampPct(inputs.rates.l1ToTransferPct) / 100;
  const l2Conv = clampPct(inputs.rates.l2ConvPct) / 100;
  const fromL1Share = clampPct(inputs.rates.fromL1SharePct) / 100;
  const connected = clampPct(inputs.rates.connectedPct) / 100;

  const { leadsPerActiveL1, closesPerActiveL2 } = inputs.capacity;

  let feasible = true;

  // L2 leads needed to close `target` at the historic L2 conversion.
  let requiredL2Leads = 0;
  if (l2Conv > 0) {
    requiredL2Leads = Math.ceil(target / l2Conv);
  } else if (target > 0) {
    feasible = false;
    warnings.push("L2 conversion is 0% in the baseline — can't size the lead funnel. Log some closed-won entries or raise the L2 slider.");
  }

  const requiredFromL1 = Math.round(requiredL2Leads * fromL1Share);
  const requiredDirect = Math.max(0, requiredL2Leads - requiredFromL1);

  // L1 leads needed to feed `requiredFromL1` transfers at the historic hand-off rate.
  let requiredL1Leads = 0;
  if (requiredFromL1 > 0) {
    if (l1ToTransfer > 0) {
      requiredL1Leads = Math.ceil(requiredFromL1 / l1ToTransfer);
    } else {
      feasible = false;
      warnings.push("L1→L2 hand-off rate is 0% — can't size L1 leads. Raise the L1 slider.");
    }
  }

  const requiredTotalLeads = requiredL1Leads + requiredDirect;

  // Headcount from per-head capacity.
  let requiredL1Bdes = 0;
  if (requiredL1Leads > 0) {
    if (leadsPerActiveL1 > 0) {
      requiredL1Bdes = Math.ceil(requiredL1Leads / leadsPerActiveL1);
    } else {
      warnings.push("No historic L1 capacity (leads per active L1 BDE) — L1 headcount can't be estimated.");
    }
  }

  let requiredL2Bdes = 0;
  if (target > 0) {
    if (closesPerActiveL2 > 0) {
      requiredL2Bdes = Math.ceil(target / closesPerActiveL2);
    } else {
      warnings.push("No historic L2 capacity (closes per active L2 BDE) — L2 headcount can't be estimated.");
    }
  }

  const l1Gap = requiredL1Bdes - inputs.roster.activeL1;
  const l2Gap = requiredL2Bdes - inputs.roster.activeL2;

  // Reverse funnel stages for the chart. Connected is clamped to ≤ leads so the
  // trapezoid always tapers; the final stage shows the true target (the goal).
  const connectedVal = Math.min(requiredTotalLeads, Math.round(requiredTotalLeads * connected));
  const stages: PlannerStage[] = [
    { key: "leads", label: "Leads needed", value: requiredTotalLeads },
    { key: "connected", label: "Connected", value: connectedVal },
    { key: "won", label: "Enrollments (target)", value: target },
  ];

  // Meta budget lever (blended): the target requires `requiredL2Leads` qualified
  // (L2) leads; each is valued at the blended cost-per-qualified-lead, so the ad
  // budget = requiredL2Leads × costPerQualifiedLead. Recomputes live with the
  // sliders (requiredL2Leads moves) so funding follows the plan.
  let metaOut: PlannerMetaOutput | null = null;
  if (inputs.meta) {
    const m = inputs.meta;
    const requiredBudget =
      m.costPerQualifiedLead != null && m.costPerQualifiedLead > 0
        ? Math.round(requiredL2Leads * m.costPerQualifiedLead)
        : null;
    const currentSpend = Math.round(m.currentSpendPerMonth);
    metaOut = {
      requiredQualifiedLeadsPerMonth: requiredL2Leads,
      requiredBudgetPerMonth: requiredBudget,
      costPerQualifiedLead: m.costPerQualifiedLead,
      currentQualifiedLeadsPerMonth: Math.round(m.currentQualifiedLeadsPerMonth),
      currentSpendPerMonth: currentSpend,
      budgetDeltaPerMonth: requiredBudget != null ? requiredBudget - currentSpend : null,
    };
    if (m.costPerQualifiedLead == null && requiredL2Leads > 0) {
      warnings.push(
        "No Meta spend recorded for the baseline window, so the cost-per-qualified-lead (and budget) can't be computed. Enter this month's Meta spend in the Growth Planner to enable it.",
      );
    }
  }

  return {
    target,
    feasible,
    requiredL2Leads,
    requiredFromL1,
    requiredDirect,
    requiredL1Leads,
    requiredTotalLeads,
    requiredL1Bdes,
    requiredL2Bdes,
    l1Gap,
    l2Gap,
    stages,
    meta: metaOut,
    warnings,
  };
}
