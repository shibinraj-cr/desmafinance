import { describe, it, expect } from "vitest";
import { computePlan, type PlannerInputs } from "@/lib/lead-pulse-planner";

/** Baseline that produces round numbers; override per-test. */
function inputs(over: Partial<PlannerInputs> = {}): PlannerInputs {
  return {
    targetClosedWon: over.targetClosedWon ?? 100,
    rates: {
      l1ToTransferPct: 50,
      l2ConvPct: 20,
      fromL1SharePct: 100,
      connectedPct: 60,
      ...(over.rates ?? {}),
    },
    capacity: { leadsPerActiveL1: 100, closesPerActiveL2: 10, ...(over.capacity ?? {}) },
    roster: { activeL1: 5, activeL2: 2, ...(over.roster ?? {}) },
    ...(over.meta ? { meta: over.meta } : {}),
  };
}

describe("computePlan — back-calculation", () => {
  it("sizes leads + headcount for an all-via-L1 funnel", () => {
    const p = computePlan(inputs());
    expect(p.feasible).toBe(true);
    expect(p.requiredL2Leads).toBe(500); // 100 / 0.20
    expect(p.requiredFromL1).toBe(500); // 100% share
    expect(p.requiredDirect).toBe(0);
    expect(p.requiredL1Leads).toBe(1000); // 500 / 0.50
    expect(p.requiredTotalLeads).toBe(1000);
    expect(p.requiredL1Bdes).toBe(10); // 1000 / 100
    expect(p.requiredL2Bdes).toBe(10); // 100 / 10
    expect(p.l1Gap).toBe(5); // 10 − 5
    expect(p.l2Gap).toBe(8); // 10 − 2
  });

  it("splits direct vs L1-sourced leads by the historic share", () => {
    const p = computePlan(
      inputs({
        rates: { l1ToTransferPct: 50, l2ConvPct: 25, fromL1SharePct: 60, connectedPct: 60 },
        capacity: { leadsPerActiveL1: 200, closesPerActiveL2: 20 },
        roster: { activeL1: 10, activeL2: 5 },
      }),
    );
    expect(p.requiredL2Leads).toBe(400); // 100 / 0.25
    expect(p.requiredFromL1).toBe(240); // 400 × 0.6
    expect(p.requiredDirect).toBe(160);
    expect(p.requiredL1Leads).toBe(480); // 240 / 0.5
    expect(p.requiredTotalLeads).toBe(640); // 480 + 160
    expect(p.requiredL1Bdes).toBe(3); // ceil(480 / 200)
    expect(p.requiredL2Bdes).toBe(5); // ceil(100 / 20)
    expect(p.l1Gap).toBe(-7); // headroom
    expect(p.l2Gap).toBe(0);
  });

  it("uses ceil so fractional leads/heads round up", () => {
    const p = computePlan(inputs({ targetClosedWon: 101 }));
    expect(p.requiredL2Leads).toBe(505); // ceil(101 / 0.20) = 505
    expect(p.requiredL1Leads).toBe(1010); // ceil(505 / 0.5)
    expect(p.requiredL1Bdes).toBe(11); // ceil(1010 / 100)
  });
});

describe("computePlan — guards & edge cases", () => {
  it("flags infeasible when L2 conversion is zero", () => {
    const p = computePlan(inputs({ rates: { l1ToTransferPct: 50, l2ConvPct: 0, fromL1SharePct: 100, connectedPct: 60 } }));
    expect(p.feasible).toBe(false);
    expect(p.requiredL2Leads).toBe(0);
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it("returns an all-zero plan for a zero target (still feasible)", () => {
    const p = computePlan(inputs({ targetClosedWon: 0 }));
    expect(p.feasible).toBe(true);
    expect(p.requiredTotalLeads).toBe(0);
    expect(p.requiredL1Bdes).toBe(0);
    expect(p.requiredL2Bdes).toBe(0);
  });

  it("warns and skips headcount when capacity is missing", () => {
    const p = computePlan(inputs({ capacity: { leadsPerActiveL1: 0, closesPerActiveL2: 0 } }));
    expect(p.requiredL1Bdes).toBe(0);
    expect(p.requiredL2Bdes).toBe(0);
    expect(p.warnings.some((w) => /capacity/i.test(w))).toBe(true);
  });

  it("clamps out-of-range rates instead of throwing", () => {
    const p = computePlan(inputs({ rates: { l1ToTransferPct: 250, l2ConvPct: -10, fromL1SharePct: 100, connectedPct: 60 } }));
    // l2ConvPct clamps to 0 → infeasible, but no crash.
    expect(p.feasible).toBe(false);
    expect(Number.isFinite(p.requiredTotalLeads)).toBe(true);
  });
});

describe("computePlan — Meta budget lever (blended)", () => {
  // Default inputs() ⇒ requiredL2Leads = ceil(100 / 0.20) = 500 qualified leads.
  it("sizes Meta budget from required qualified leads × cost-per-qualified-lead", () => {
    const p = computePlan(
      inputs({
        meta: { costPerQualifiedLead: 50, currentQualifiedLeadsPerMonth: 500, currentSpendPerMonth: 25000 },
      }),
    );
    expect(p.meta).not.toBeNull();
    expect(p.meta!.requiredQualifiedLeadsPerMonth).toBe(500); // = requiredL2Leads
    expect(p.meta!.requiredBudgetPerMonth).toBe(25000); // 500 × ₹50
    expect(p.meta!.costPerQualifiedLead).toBe(50);
    expect(p.meta!.budgetDeltaPerMonth).toBe(0); // vs current ₹25,000
  });

  it("reflects the delta when the required budget exceeds current spend", () => {
    const p = computePlan(
      inputs({
        meta: { costPerQualifiedLead: 60, currentQualifiedLeadsPerMonth: 500, currentSpendPerMonth: 20000 },
      }),
    );
    expect(p.meta!.requiredBudgetPerMonth).toBe(30000); // 500 × ₹60
    expect(p.meta!.budgetDeltaPerMonth).toBe(10000); // 30000 − 20000
  });

  it("returns null budget + a warning when cost-per-qualified-lead is unknown", () => {
    const p = computePlan(
      inputs({
        meta: { costPerQualifiedLead: null, currentQualifiedLeadsPerMonth: 0, currentSpendPerMonth: 0 },
      }),
    );
    expect(p.meta!.requiredQualifiedLeadsPerMonth).toBe(500);
    expect(p.meta!.requiredBudgetPerMonth).toBeNull();
    expect(p.warnings.some((w) => /cost-per-qualified-lead/i.test(w))).toBe(true);
  });

  it("omits the Meta plan entirely when no Meta lever is supplied", () => {
    expect(computePlan(inputs()).meta).toBeNull();
  });
});

describe("computePlan — funnel stages", () => {
  it("produces a monotonically tapering reverse funnel", () => {
    const p = computePlan(
      inputs({ rates: { l1ToTransferPct: 50, l2ConvPct: 20, fromL1SharePct: 100, connectedPct: 90 } }),
    );
    const vals = p.stages.map((s) => s.value);
    expect(p.stages.map((s) => s.key)).toEqual(["leads", "connected", "won"]);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeLessThanOrEqual(vals[i - 1]);
    }
    expect(vals[0]).toBe(p.requiredTotalLeads);
    expect(vals[vals.length - 1]).toBe(p.target);
  });
});
