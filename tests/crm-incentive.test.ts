import { describe, it, expect } from "vitest";

// crm-incentive is pure — no prisma import, so no module mock is needed.
import {
  NO_BONUSES,
  computeBdePay,
  computeTeamPool,
  doubleBookedMember,
  isFastClose,
  isIncentiveMonthClosed,
  isTeamEligible,
  milestones,
  nextPayingMilestone,
  quarterMembers,
  quarterMonths,
  quarterOf,
  slabColumns,
  slabLadder,
  slabReached,
  slabsFromRow,
  splitByWeight,
  validateSlabs,
  type MonthBonuses,
  type Slab,
} from "@/lib/crm-incentive";

// The worked example: no incentive below 10, ₹1,000 each from 10, ₹1,500 each from 16.
const SLABS: Slab[] = [
  { from: 10, rate: 1000 },
  { from: 16, rate: 1500 },
];
const BONUSES: MonthBonuses = { targetBonus: 5000, fastCloseBonus: 250, referralBonus: 100 };

function pay(enrolled: number, extra: Partial<Parameters<typeof computeBdePay>[0]> = {}) {
  return computeBdePay({ enrolled, fastCloses: 0, referrals: 0, target: 0, slabs: SLABS, bonuses: NO_BONUSES, ...extra });
}

describe("slab columns", () => {
  it("round-trips through the row columns and skips half-set slabs", () => {
    const cols = slabColumns([{ from: 10, rate: 1000 }, { from: 16, rate: 1500 }]);
    expect(cols).toMatchObject({ slab1From: 10, slab2Rate: 1500, slab3From: null, slab4Rate: null });
    expect(slabsFromRow(cols)).toEqual(SLABS);
    expect(slabsFromRow({ ...cols, slab3From: 20 })).toEqual(SLABS);
  });
});

describe("validateSlabs", () => {
  it("accepts rising slabs, empty slabs and no slabs at all", () => {
    expect(validateSlabs([{ from: 10, rate: 1000 }, { from: 16, rate: 1500 }, { from: null, rate: null }])).toBeNull();
    expect(validateSlabs([])).toBeNull();
    expect(validateSlabs([{ from: 10, rate: 1000 }, { from: 16, rate: 1000 }])).toBeNull();
  });

  it("rejects a half-filled slab, gaps, non-rising starts, falling amounts and fractions", () => {
    expect(validateSlabs([{ from: 10, rate: null }])).toMatch(/both/);
    expect(validateSlabs([{ from: null, rate: null }, { from: 16, rate: 1500 }])).toMatch(/in order/);
    expect(validateSlabs([{ from: 10, rate: 1000 }, { from: 10, rate: 1500 }])).toMatch(/start higher/);
    expect(validateSlabs([{ from: 10, rate: 1500 }, { from: 16, rate: 1000 }])).toMatch(/at least as much/);
    expect(validateSlabs([{ from: 9.5, rate: 1000 }])).toMatch(/whole number/);
    expect(validateSlabs([{ from: 0, rate: 1000 }])).toMatch(/1 or more/);
    expect(validateSlabs(Array.from({ length: 5 }, (_, i) => ({ from: i + 1, rate: 100 })))).toMatch(/At most 4/);
  });
});

describe("computeBdePay — all-units slabs", () => {
  it("pays nothing below slab 1, then the reached slab's rate on every enrolment", () => {
    expect(pay(9).total).toBe(0);
    expect(pay(9).slabIndex).toBeNull();
    expect(pay(10).total).toBe(10_000);
    expect(pay(15).total).toBe(15_000);
    expect(pay(16)).toMatchObject({ slabIndex: 1, rate: 1500, total: 24_000 });
  });

  it("pays fractional (half-weight) enrolments pro rata", () => {
    expect(pay(10.5).slabPay).toBe(10_500);
    expect(pay(9.5).slabPay).toBe(0);
  });

  it("adds the target bonus at target, and the per-enrolment 48h and referral bonuses", () => {
    const p = pay(11, { target: 14, fastCloses: 2, referrals: 1, bonuses: BONUSES });
    expect(p).toMatchObject({ slabPay: 11_000, targetMet: false, targetPay: 0, fastPay: 500, referralPay: 100, total: 11_600 });
    expect(pay(14, { target: 14, bonuses: BONUSES })).toMatchObject({ targetMet: true, targetPay: 5000, total: 19_000 });
  });

  it("never treats a missing target as met", () => {
    expect(pay(20, { target: 0, bonuses: BONUSES }).targetMet).toBe(false);
  });

  it("picks the highest slab reached even if slabs arrive out of order", () => {
    expect(slabReached(17, [SLABS[1], SLABS[0]])).toBe(0);
  });
});

describe("milestones", () => {
  const input = { enrolled: 11, fastCloses: 2, referrals: 1, target: 14, slabs: SLABS, bonuses: BONUSES, minimum: 8 };

  it("lists minimum, slabs and target in the order they are reached, with gaps and pay on reaching", () => {
    const list = milestones(input);
    expect(list.map((m) => [m.kind, m.at, m.reached, m.gap])).toEqual([
      ["minimum", 8, true, 0],
      ["slab", 10, true, 0],
      ["target", 14, false, 3],
      ["slab", 16, false, 5],
    ]);
    expect(list.find((m) => m.kind === "target")!.payAt).toBe(19_600);
    expect(list.find((m) => m.at === 16)!.payAt).toBe(29_600);
  });

  it("next paying milestone is the target bonus, then the next slab", () => {
    expect(nextPayingMilestone(milestones(input), BONUSES)).toMatchObject({ kind: "target", gap: 3 });
    expect(nextPayingMilestone(milestones(input), { ...BONUSES, targetBonus: 0 })).toMatchObject({ kind: "slab", at: 16 });
    expect(nextPayingMilestone(milestones({ ...input, enrolled: 20 }), BONUSES)).toBeNull();
  });

  it("gives fractional gaps for half-weight enrolments", () => {
    expect(milestones({ ...input, enrolled: 9.5 }).find((m) => m.at === 10)!.gap).toBe(0.5);
  });
});

describe("isFastClose", () => {
  const h = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 3_600_000);

  it("counts an Enroll within 48h of the last assignment before it", () => {
    expect(isFastClose({ enrolledAt: h(48), assignedAts: [h(0)], leadCreatedAt: h(-100) })).toBe(true);
    expect(isFastClose({ enrolledAt: h(49), assignedAts: [h(0)], leadCreatedAt: h(-100) })).toBe(false);
  });

  it("uses the latest assignment before the click and ignores ones after it", () => {
    expect(isFastClose({ enrolledAt: h(100), assignedAts: [h(0), h(60), h(120)], leadCreatedAt: h(-1) })).toBe(true);
  });

  it("falls back to the lead's creation when nothing was assigned before the click", () => {
    expect(isFastClose({ enrolledAt: h(10), assignedAts: [h(20)], leadCreatedAt: h(0) })).toBe(true);
    expect(isFastClose({ enrolledAt: h(60), assignedAts: [], leadCreatedAt: h(0) })).toBe(false);
  });
});

describe("splitByWeight", () => {
  it("splits in whole rupees that add up to the pool exactly", () => {
    const parts = splitByWeight(10_000, [1, 1, 1]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(10_000);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });

  it("gives zero-weight members nothing, and nothing at all with no weight", () => {
    expect(splitByWeight(15_000, [11, 0, 11])).toEqual([7500, 0, 7500]);
    expect(splitByWeight(15_000, [0, 0])).toEqual([0, 0]);
  });
});

describe("computeTeamPool", () => {
  const members = [
    { userId: "a", enrolled: 14, minimum: 8 },
    { userId: "b", enrolled: 12, minimum: 10 },
    { userId: "c", enrolled: 4, minimum: 6 },
  ];

  it("counts everyone toward the target but splits only among members who reached their minimum", () => {
    const t = computeTeamPool({ target: 30, pool: 15_000, members });
    expect(t).toMatchObject({ teamTotal: 30, hit: true, gap: 0 });
    const by = Object.fromEntries(t.members.map((m) => [m.userId, m]));
    expect(by.c).toMatchObject({ eligible: false, share: 0 });
    expect(by.a.share + by.b.share).toBe(15_000);
    expect(by.a.share).toBe(8077); // 15,000 × 14/26
  });

  it("pays nothing until the target is hit, but shows the share at today's split", () => {
    const t = computeTeamPool({ target: 40, pool: 15_000, members });
    expect(t).toMatchObject({ hit: false, gap: 10 });
    expect(t.members.every((m) => m.share === 0)).toBe(true);
    expect(t.members.find((m) => m.userId === "a")!.shareIfHit).toBe(8077);
  });

  it("treats a member with no enrolments as not eligible even with no minimum", () => {
    expect(isTeamEligible({ userId: "x", enrolled: 0, minimum: 0 })).toBe(false);
    expect(isTeamEligible({ userId: "x", enrolled: 1, minimum: 0 })).toBe(true);
  });
});

describe("quarters", () => {
  it("maps months to calendar quarters", () => {
    expect([1, 3, 4, 10, 12].map(quarterOf)).toEqual([1, 1, 2, 4, 4]);
    expect(quarterMonths(4)).toEqual([10, 11, 12]);
  });

  it("sums each member's months in this team only — a mover's months stay with the old team", () => {
    const facts = [
      { month: 10, teamId: "alpha", userId: "a", enrolled: 14, minimum: 8 },
      { month: 11, teamId: "alpha", userId: "a", enrolled: 11, minimum: 8 },
      { month: 10, teamId: "alpha", userId: "m", enrolled: 9, minimum: 8 },
      { month: 11, teamId: "beta", userId: "m", enrolled: 7, minimum: 8 },
    ];
    expect(quarterMembers(facts, "alpha")).toEqual([
      { userId: "a", enrolled: 25, minimum: 16 },
      { userId: "m", enrolled: 9, minimum: 8 },
    ]);
    expect(quarterMembers(facts, "beta")).toEqual([{ userId: "m", enrolled: 7, minimum: 8 }]);
  });
});

describe("setup helpers", () => {
  it("lays slabs out as pay bands from zero", () => {
    expect(slabLadder(SLABS)).toEqual([
      { from: 0, to: 9, rate: 0, payFrom: 0, payTo: 0 },
      { from: 10, to: 15, rate: 1000, payFrom: 10_000, payTo: 15_000 },
      { from: 16, to: null, rate: 1500, payFrom: 24_000, payTo: null },
    ]);
    expect(slabLadder([])).toEqual([]);
  });

  it("closes every month before the current IST month", () => {
    expect(isIncentiveMonthClosed(2026, 10, "2026-11-10")).toBe(true);
    expect(isIncentiveMonthClosed(2025, 12, "2026-01-01")).toBe(true);
    expect(isIncentiveMonthClosed(2026, 11, "2026-11-30")).toBe(false);
    expect(isIncentiveMonthClosed(2026, 12, "2026-11-10")).toBe(false);
  });

  it("finds a BDE placed in two teams", () => {
    expect(doubleBookedMember([{ teamId: "a", userIds: ["x", "y"] }, { teamId: "b", userIds: ["z"] }])).toBeNull();
    expect(doubleBookedMember([{ teamId: "a", userIds: ["x", "y"] }, { teamId: "b", userIds: ["y"] }])).toBe("y");
  });
});
