import { describe, expect, it } from "vitest";

// Pure: the standing is built with the real engine, so the card is tested
// against the same numbers the Marketing sheet shows.
import { closedMonthLine, incentiveCard } from "@/lib/crm-incentive-card";
import { computeBdePay, computeTeamPool, milestones, type MonthBonuses, type Slab, type TeamMemberPeriod } from "@/lib/crm-incentive";
import type { BdeStanding, TeamPoolForMember } from "@/lib/crm-incentive-data";

const BONUSES: MonthBonuses = { targetBonus: 5000, fastCloseBonus: 250, referralBonus: 100 };
const SLABS: Slab[] = [
  { from: 10, rate: 1000 },
  { from: 16, rate: 1500 },
  { from: 20, rate: 2000 },
];

function pool(target: number, poolAmount: number, members: TeamMemberPeriod[]): TeamPoolForMember {
  const { members: all, ...rest } = computeTeamPool({ target, pool: poolAmount, members });
  return { ...rest, me: all.find((m) => m.userId === "me") ?? null, size: all.length, qualifying: all.filter((m) => m.eligible).length };
}

function standing(o: {
  enrolled: number;
  target?: number;
  minimum?: number | null;
  slabs?: Slab[];
  fast?: number;
  ref?: number;
  team?: BdeStanding["team"];
  bonuses?: MonthBonuses;
}): BdeStanding {
  const target = o.target ?? 14;
  const minimum = o.minimum === undefined ? 8 : o.minimum;
  const slabs = o.slabs ?? SLABS;
  const facts = { enrolled: o.enrolled, fastCloses: o.fast ?? 0, referrals: o.ref ?? 0 };
  const input = { ...facts, target, slabs, bonuses: o.bonuses ?? BONUSES };
  return {
    userId: "me",
    name: "L2 BDE",
    target,
    minimum,
    slabs,
    configured: true,
    facts,
    pay: computeBdePay(input),
    milestones: milestones({ ...input, minimum }),
    team: o.team ?? null,
  };
}

const NOV = { year: 2026, month: 11, bonuses: BONUSES, today: "2026-11-18" };

describe("incentiveCard — the worked example", () => {
  // 11 enrolments, 2 fast closes, 1 own referral; team of two at 11 each; quarter 25 of 58.
  const team = {
    teamId: "alpha",
    name: "Team Alpha",
    month: pool(30, 15000, [
      { userId: "me", enrolled: 11, minimum: 8 },
      { userId: "x", enrolled: 11, minimum: 8 },
    ]),
    quarter: pool(90, 45000, [
      { userId: "me", enrolled: 25, minimum: 24 },
      { userId: "x", enrolled: 33, minimum: 24 },
    ]),
  };
  const card = incentiveCard({ ...NOV, bde: standing({ enrolled: 11, fast: 2, ref: 1, team }) });

  it("heads the card with the month, the day and the pace", () => {
    expect(card.title).toBe("November so far");
    expect(card.daysNote).toBe("Day 18 of 30 · 12 days left");
    expect(card.pace).toEqual({ good: true, label: "Ahead of pace" });
  });

  it("totals the provisional incentive with its breakdown", () => {
    expect(card.total).toBe(11_600);
    expect(card.lines).toEqual([
      { label: "11 × ₹1,000 (slab 1)", amount: 11_000 },
      { label: "2 closed within 48h × ₹250", amount: 500 },
      { label: "1 own referral × ₹100", amount: 100 },
    ]);
  });

  it("names the next paying step and what follows", () => {
    expect(card.next).toBe("**3 more** for your **₹5,000 target bonus** — then 2 more and all 16 pay ₹1,500 each.");
    expect(card.belowSlabs).toBe(false);
  });

  it("shows what each step ahead would pay, and the team share", () => {
    expect(card.ahead).toEqual([
      { label: "At 14 (target bonus)", amount: 19_600 },
      { label: "At 16 (slab 2)", amount: 29_600 },
      { label: "At 20 (slab 3)", amount: 45_600 },
      { label: "Team share if Team Alpha hits 30", amount: 7_500, approx: true },
    ]);
  });

  it("lays out the ladder: done, paying now, next, ahead", () => {
    expect(card.ladder.map((s) => [s.title, s.state, s.note])).toEqual([
      ["Minimum · 8", "done", "Reached"],
      ["Slab 1 · 10", "current", "Earning ₹1,000 each"],
      ["Target · 14", "next", "3 more → +₹5,000 bonus"],
      ["Slab 2 · 16", "ahead", "5 more → ₹1,500 × all"],
      ["Slab 3 · 20", "ahead", "9 more → ₹2,000 × all"],
    ]);
  });

  it("marks the bar with each step and describes it for screen readers", () => {
    expect(card.bar!.markers.map((m) => m.label)).toEqual(["Min 8 ✓", "₹1,000 · 10", "Target 14", "₹1,500 · 16", "₹2,000 · 20"]);
    // Slabs 16 and 20 sit 18% apart — the second moves out a row so the labels don't overlap.
    expect(card.bar!.markers.map((m) => m.row)).toEqual([0, 0, 0, 0, 1]);
    expect(card.bar!.fillPct).toBe(50);
    expect(card.bar!.label).toBe("11 enrolments. Reached: minimum 8, slab 1 at 10. Ahead: target 14, slab 2 at 16, slab 3 at 20.");
  });

  it("shows both team pools with the share at today's split", () => {
    expect(card.team!.status).toBe("You share the team pools — minimum 8 reached");
    expect(card.team!.pools).toEqual([
      { label: "November · 22 of 30", pool: 15000, pct: 73, hit: false, text: "Team needs **8 more**. Your share at today's split ≈ **₹7,500** (your 11 of the team's 22)." },
      {
        label: "Oct–Dec quarter · 58 of 90",
        pool: 45000,
        pct: 64,
        hit: false,
        text: "Team needs **32 more** by 31 Dec. Your share at today's split ≈ **₹19,397** (your 25 of the team's 58).",
      },
    ]);
  });

  it("explains the rules with this month's amounts", () => {
    expect(card.explain).toContain("reaching your target adds ₹5,000");
    expect(card.explain).toContain("closed within 48 hours of assignment adds ₹250");
  });
});

describe("incentiveCard — other states", () => {
  it("below slab 1: one prize to unlock, behind pace, not yet sharing the team pool", () => {
    const team = {
      teamId: "alpha",
      name: "Team Alpha",
      month: pool(30, 15000, [
        { userId: "me", enrolled: 7, minimum: 8 },
        { userId: "x", enrolled: 12, minimum: 8 },
      ]),
      quarter: null,
    };
    const card = incentiveCard({ ...NOV, bde: standing({ enrolled: 7, team }) });
    expect(card.pace).toEqual({ good: false, label: "1 behind pace" });
    expect(card.next).toBe("Incentive starts at 10. **3 more unlocks ₹10,000** at once — ₹1,000 for every enrolment.");
    expect(card.belowSlabs).toBe(true);
    expect(card.total).toBe(0);
    expect(card.lines).toEqual([{ label: "7 enrolments — slab 1 starts at 10", amount: 0 }]);
    expect(card.team!.status).toBe("Reach your minimum of 8 to share the pools — 1 more");
    expect(card.team!.pools[0].text).toBe("Team needs **11 more**. Your enrolments count toward it; you share once you reach your minimum.");
    expect(card.ladder[0]).toMatchObject({ title: "Minimum · 8", state: "next", note: "1 more — needed for a team share" });
  });

  it("one away from the next slab: says what the jump is worth", () => {
    const card = incentiveCard({ ...NOV, bde: standing({ enrolled: 15 }) });
    expect(card.pace).toEqual({ good: true, label: "Target reached" });
    expect(card.total).toBe(20_000);
    expect(card.next).toBe("**1 more** and all 16 pay ₹1,500 each — your incentive goes from ₹20,000 to ₹29,000.");
  });

  it("past every step", () => {
    const card = incentiveCard({ ...NOV, bde: standing({ enrolled: 22 }) });
    expect(card.next).toBe("You've passed every step this month — each extra enrolment adds ₹2,000.");
  });

  it("keeps half enrolments to one decimal", () => {
    const card = incentiveCard({ ...NOV, bde: standing({ enrolled: 9.5 }) });
    expect(card.next).toBe("Incentive starts at 10. **0.5 more unlocks ₹10,000** at once — ₹1,000 for every enrolment.");
    expect(card.lines[0].label).toBe("9.5 enrolments — slab 1 starts at 10");
  });

  it("nothing set for the month: says so and shows no ladder", () => {
    const card = incentiveCard({ ...NOV, bde: standing({ enrolled: 3, target: 0, minimum: null, slabs: [] }) });
    expect(card.setUp).toBe(false);
    expect(card.notice).toMatch(/^Your November target and incentive slabs aren't set yet/);
    expect(card.bar).toBeNull();
    expect(card.ladder).toEqual([]);
    expect(card.pace).toBeNull();
  });

  it("a target but no slabs: the target bonus is the next step", () => {
    const card = incentiveCard({ ...NOV, bde: standing({ enrolled: 4, slabs: [] }) });
    expect(card.notice).toMatch(/slabs aren't set yet — until Marketing Admin sets them, only the bonuses count/);
    expect(card.next).toBe("**10 more** for your **₹5,000 target bonus**.");
  });

  it("explains a bigger share when only some members qualify", () => {
    const team = {
      teamId: "alpha",
      name: "Team Alpha",
      month: pool(30, 15000, [
        { userId: "me", enrolled: 11, minimum: 8 },
        { userId: "x", enrolled: 5, minimum: 10 },
      ]),
      quarter: null,
    };
    const card = incentiveCard({ ...NOV, bde: standing({ enrolled: 11, team }) });
    expect(card.team!.pools[0].text).toBe(
      "Team needs **14 more**. Your share at today's split ≈ **₹15,000** — only 1 of 2 members has reached their minimum so far.",
    );
  });

  it("a month pool already hit is counted in the total", () => {
    const team = {
      teamId: "alpha",
      name: "Team Alpha",
      month: pool(20, 10000, [
        { userId: "me", enrolled: 12, minimum: 8 },
        { userId: "x", enrolled: 8, minimum: 8 },
      ]),
      quarter: null,
    };
    const card = incentiveCard({ ...NOV, bde: standing({ enrolled: 12, team }) });
    expect(card.lines.at(-1)).toEqual({ label: "Team Alpha November pool share", amount: 6000, approx: true });
    expect(card.total).toBe(12_000 + 6000);
    expect(card.team!.pools[0].text).toBe("Target reached — your share ≈ **₹6,000** (your 12 of the team's 20).");
  });

  it("counts the days of the month in IST", () => {
    expect(incentiveCard({ ...NOV, today: "2026-11-30", bde: standing({ enrolled: 0 }) }).daysNote).toBe("Last day of the month");
    expect(incentiveCard({ ...NOV, today: "2026-11-29", bde: standing({ enrolled: 0 }) }).daysNote).toBe("Day 29 of 30 · 1 day left");
  });
});

describe("closedMonthLine", () => {
  const team = {
    teamId: "alpha",
    name: "Team Alpha",
    month: pool(20, 10000, [
      { userId: "me", enrolled: 15, minimum: 8 },
      { userId: "x", enrolled: 5, minimum: 8 },
    ]),
    quarter: pool(40, 20000, [
      { userId: "me", enrolled: 30, minimum: 24 },
      { userId: "x", enrolled: 10, minimum: 24 },
    ]),
  };

  it("sums last month with its parts; the quarter pool only at quarter end", () => {
    const bde = standing({ enrolled: 15, fast: 2, ref: 1, team });
    expect(closedMonthLine({ bde, bonuses: BONUSES, year: 2026, month: 10 })).toBe(
      "**October closed:** 15 enrolled → **₹30,600** (₹15,000 slab 1, ₹5,000 target bonus, ₹600 other bonuses, ₹10,000 team share). Provisional until Finance confirms.",
    );
    expect(closedMonthLine({ bde, bonuses: BONUSES, year: 2026, month: 12 })).toContain("→ **₹50,600**");
  });

  it("says nothing when the month had no incentive set and nothing earned", () => {
    expect(closedMonthLine({ bde: standing({ enrolled: 2, target: 0, slabs: [] }), bonuses: BONUSES, year: 2026, month: 10 })).toBeNull();
  });
});
