import { describe, it, expect, vi } from "vitest";

// crm-daily-report (via crm-team / crm-leads / usage-metrics) constructs the
// prisma client at module load. The functions under test are pure, so mock
// prisma to avoid a real DB.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  IST_OFFSET_MS,
  istDayWindow,
  resolveReportDay,
  canSubmitOn,
  resolveReportScope,
  isReviewed,
  canEditNarrative,
  canReviewReports,
} from "@/lib/crm-daily-report";

describe("istDayWindow", () => {
  it("bounds the IST calendar day in UTC (offset +5:30)", () => {
    expect(IST_OFFSET_MS).toBe(19_800_000);
    const w = istDayWindow("2026-07-30");
    expect(w.fromUtc.toISOString()).toBe("2026-07-29T18:30:00.000Z");
    expect(w.toUtc.toISOString()).toBe("2026-07-30T18:30:00.000Z");
    expect(w.dayDate.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("places an IST 00:15 activity INSIDE the day (the server-TZ bug this avoids)", () => {
    const w = istDayWindow("2026-07-30");
    // IST 2026-07-30 00:15 == UTC 2026-07-29 18:45 — the prior UTC day.
    const early = new Date("2026-07-29T18:45:00.000Z");
    expect(early.getTime() >= w.fromUtc.getTime()).toBe(true);
    expect(early.getTime() < w.toUtc.getTime()).toBe(true);
  });

  it("keeps an IST 23:59 activity inside and pushes the next day's 00:15 out", () => {
    const w = istDayWindow("2026-07-30");
    const lateSameDay = new Date("2026-07-30T18:29:00.000Z"); // IST 23:59
    const earlyNextDay = new Date("2026-07-30T18:45:00.000Z"); // IST 00:15 next day
    expect(lateSameDay.getTime() < w.toUtc.getTime()).toBe(true);
    expect(earlyNextDay.getTime() >= w.toUtc.getTime()).toBe(true);
  });

  it("half-open windows for consecutive days abut exactly (no gap, no overlap)", () => {
    expect(istDayWindow("2026-07-30").toUtc.toISOString()).toBe(
      istDayWindow("2026-07-31").fromUtc.toISOString(),
    );
  });
});

describe("resolveReportDay", () => {
  const today = "2026-07-30";
  it("defaults to today when unset or malformed", () => {
    expect(resolveReportDay(undefined, today)).toBe(today);
    expect(resolveReportDay("", today)).toBe(today);
    expect(resolveReportDay("nope", today)).toBe(today);
    expect(resolveReportDay("2026-7-3", today)).toBe(today);
  });
  it("rejects impossible dates (JS would roll 02-31 into March)", () => {
    expect(resolveReportDay("2026-02-31", today)).toBe(today);
  });
  it("never returns a future day", () => {
    expect(resolveReportDay("2026-08-01", today)).toBe(today);
  });
  it("accepts a valid past day unchanged", () => {
    expect(resolveReportDay("2026-07-28", today)).toBe("2026-07-28");
    expect(resolveReportDay(today, today)).toBe(today);
  });
});

describe("canSubmitOn", () => {
  const today = "2026-07-30";
  it("allows today and the prior 3 days", () => {
    expect(canSubmitOn("2026-07-30", today)).toBe(true);
    expect(canSubmitOn("2026-07-27", today)).toBe(true);
  });
  it("rejects days older than the backdate window and any future day", () => {
    expect(canSubmitOn("2026-07-26", today)).toBe(false);
    expect(canSubmitOn("2026-07-31", today)).toBe(false);
  });
});

describe("resolveReportScope", () => {
  const bde = { isAdmin: false, isSupervisor: false, canManageCrm: false, isCrmTeamLead: false, userId: "u1" };
  const mgr = { isAdmin: false, isSupervisor: true, canManageCrm: false, isCrmTeamLead: false, userId: "m1" };

  it("locks a plain BDE to their own report and ignores a requested bde", () => {
    const s = resolveReportScope(bde, "someone-else");
    expect(s).toEqual({ selfUserId: "u1", canViewOthers: false, targetUserId: "u1", rollup: false });
  });

  it("lands a manager on the team roll-up with no selection", () => {
    const s = resolveReportScope(mgr);
    expect(s.canViewOthers).toBe(true);
    expect(s.rollup).toBe(true);
    expect(s.targetUserId).toBeNull();
  });

  it("shows a manager the requested BDE's report", () => {
    const s = resolveReportScope(mgr, "u9");
    expect(s.rollup).toBe(false);
    expect(s.targetUserId).toBe("u9");
  });
});

describe("state predicates", () => {
  it("isReviewed reflects status", () => {
    expect(isReviewed(null)).toBe(false);
    expect(isReviewed({ status: "submitted" })).toBe(false);
    expect(isReviewed({ status: "reviewed" })).toBe(true);
  });

  it("canEditNarrative: owner may edit until reviewed; non-owner never", () => {
    expect(canEditNarrative(null, true)).toBe(true); // owner, not yet submitted
    expect(canEditNarrative({ status: "submitted" }, true)).toBe(true);
    expect(canEditNarrative({ status: "reviewed" }, true)).toBe(false);
    expect(canEditNarrative({ status: "submitted" }, false)).toBe(false);
  });

  it("canReviewReports: managers only", () => {
    expect(canReviewReports({ isAdmin: false, isSupervisor: false, canManageCrm: false })).toBe(false);
    expect(canReviewReports({ isAdmin: true, isSupervisor: false, canManageCrm: false })).toBe(true);
    expect(canReviewReports({ isAdmin: false, isSupervisor: true, canManageCrm: false })).toBe(true);
    expect(canReviewReports({ isAdmin: false, isSupervisor: false, canManageCrm: true })).toBe(true);
  });
});
