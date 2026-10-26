import { describe, it, expect, vi } from "vitest";

// crm-lifecycle imports the prisma-backed sweep alongside the pure rules under
// test; mock prisma so no client is built.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  FOLLOW_UP_CAP_DAYS,
  REMARKETING_CAP_DAYS,
  extendedFollowUpUntil,
  followUpClockStart,
  followUpDeadline,
  lifecycleVerdict,
  needsFollowUpReview,
  wholeDaysSince,
  type LifecycleConfig,
} from "@/lib/crm-lifecycle";
import { isSameOwnerRevival } from "@/lib/crm-assign";

const DAY = 86_400_000;
const now = new Date("2026-11-30T06:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
const on: LifecycleConfig = { followUpEnabled: true, remarketingEnabled: true, followUpSince: null };
const off: LifecycleConfig = { followUpEnabled: false, remarketingEnabled: false, followUpSince: null };
const lead = (statusCode: string, enteredDaysAgo: number, extendedUntil: Date | null = null) => ({
  statusCode,
  stageEnteredAt: daysAgo(enteredDaysAgo),
  createdAt: daysAgo(400),
  followUpExtendedUntil: extendedUntil,
});

describe("lifecycleVerdict — Re-marketing cap", () => {
  it("moves a lead MORE than 60 days in Re-marketing; day 60 itself stays", () => {
    expect(lifecycleVerdict(lead("re_marketing", REMARKETING_CAP_DAYS + 1), on, now)?.rule).toBe("remarketing_cap");
    expect(lifecycleVerdict(lead("re_marketing", REMARKETING_CAP_DAYS), on, now)).toBeNull();
  });
  it("moves nothing while the cap is switched off", () => {
    expect(lifecycleVerdict(lead("re_marketing", 200), off, now)).toBeNull();
  });
});

describe("lifecycleVerdict — Follow-Up cap", () => {
  it("moves a lead past 45 days in Follow-Up", () => {
    expect(lifecycleVerdict(lead("follow_up", FOLLOW_UP_CAP_DAYS + 1), on, now)?.rule).toBe("followup_cap");
    expect(lifecycleVerdict(lead("follow_up", FOLLOW_UP_CAP_DAYS - 1), on, now)).toBeNull();
  });

  it("an extension keeps the lead with its consultant until it runs out", () => {
    const ext = new Date(now.getTime() + 5 * DAY);
    expect(lifecycleVerdict(lead("follow_up", 70, ext), on, now)).toBeNull();
    expect(lifecycleVerdict(lead("follow_up", 70, daysAgo(1)), on, now)?.rule).toBe("followup_cap");
  });

  it("the backlog's clock starts the day the cap was switched on, not on day one", () => {
    // In Follow-Up for a year, but the cap went live 10 days ago.
    const cfg = { ...on, followUpSince: daysAgo(10) };
    expect(lifecycleVerdict(lead("follow_up", 365), cfg, now)).toBeNull();
    expect(followUpClockStart(lead("follow_up", 365), daysAgo(10))).toEqual(daysAgo(10));
    // …and moves once 45 days have passed since then.
    const later = { ...on, followUpSince: daysAgo(FOLLOW_UP_CAP_DAYS + 2) };
    expect(lifecycleVerdict(lead("follow_up", 365), later, now)?.rule).toBe("followup_cap");
  });

  it("leaves other stages alone", () => {
    expect(lifecycleVerdict(lead("new", 300), on, now)).toBeNull();
    expect(lifecycleVerdict(lead("enrolled", 300), on, now)).toBeNull();
  });
});

describe("needsFollowUpReview", () => {
  it("lists a lead from day 40 up to its deadline", () => {
    expect(needsFollowUpReview(lead("follow_up", 41), on, now)).toBe(true);
    expect(needsFollowUpReview(lead("follow_up", 39), on, now)).toBe(false);
    expect(needsFollowUpReview(lead("follow_up", 50), on, now)).toBe(false); // already due to move
  });
  it("drops a lead once it is extended", () => {
    expect(needsFollowUpReview(lead("follow_up", 41, new Date(now.getTime() + 20 * DAY)), on, now)).toBe(false);
  });
  it("is empty while the cap is off", () => {
    expect(needsFollowUpReview(lead("follow_up", 41), off, now)).toBe(false);
  });
});

describe("extendedFollowUpUntil", () => {
  it("adds 30 days to the current deadline when it is still ahead", () => {
    const l = lead("follow_up", 41); // deadline in 4 days
    const deadline = followUpDeadline(l, null);
    expect(extendedFollowUpUntil(l, null, now)).toEqual(new Date(deadline.getTime() + 30 * DAY));
  });
  it("adds 30 days to now when the deadline has passed", () => {
    expect(extendedFollowUpUntil(lead("follow_up", 60), null, now)).toEqual(new Date(now.getTime() + 30 * DAY));
  });
});

describe("wholeDaysSince", () => {
  it("never goes negative", () => {
    expect(wholeDaysSince(now, new Date(now.getTime() + DAY))).toBe(0);
    expect(wholeDaysSince(now, daysAgo(3))).toBe(3);
  });
});

describe("isSameOwnerRevival — revived leads go to a different consultant", () => {
  it("refuses the consultant the lead was released from", () => {
    expect(isSameOwnerRevival("u1", "u1")).toBe(true);
  });
  it("allows anyone else, and leads never released to the pool", () => {
    expect(isSameOwnerRevival("u1", "u2")).toBe(false);
    expect(isSameOwnerRevival(null, "u1")).toBe(false);
    expect(isSameOwnerRevival("u1", null)).toBe(false);
  });
});
