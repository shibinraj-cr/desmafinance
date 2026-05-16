import { describe, it, expect } from "vitest";
import { validateL1Row, validateL2Row } from "@/lib/lead-pulse-validation";

describe("validateL1Row", () => {
  it("accepts the all-zero row (untouched form)", () => {
    expect(
      validateL1Row({ leadsReceived: 0, connectedCalls: 0, disqualified: 0, transferredToL2: 0 }),
    ).toBeNull();
  });
  it("accepts a row where outcomes equal received", () => {
    expect(
      validateL1Row({ leadsReceived: 5, connectedCalls: 2, disqualified: 1, transferredToL2: 2 }),
    ).toBeNull();
  });
  it("accepts a row where outcomes are below received (some leads still in progress)", () => {
    expect(
      validateL1Row({ leadsReceived: 10, connectedCalls: 3, disqualified: 1, transferredToL2: 1 }),
    ).toBeNull();
  });
  it("accepts outcomes that exceed today's received — follow-up calls on prior days' leads count too", () => {
    // BDE receives 3 new leads today but also makes follow-ups on
    // 12 leads from earlier in the week. 10 connect, 4 disqualify,
    // 6 transfer. Legitimate data — the daily outcomes pull from a
    // backlog wider than today's new intake.
    expect(
      validateL1Row({ leadsReceived: 3, connectedCalls: 10, disqualified: 4, transferredToL2: 6 }),
    ).toBeNull();
  });
  it("rejects negative numbers", () => {
    expect(
      validateL1Row({ leadsReceived: 5, connectedCalls: -1, disqualified: 0, transferredToL2: 0 }),
    ).toBe("negative");
  });
  it("rejects fractional numbers", () => {
    expect(
      validateL1Row({ leadsReceived: 5.5, connectedCalls: 0, disqualified: 0, transferredToL2: 0 }),
    ).toBe("non_integer");
  });
});

describe("validateL2Row", () => {
  it("accepts the all-zero row", () => {
    expect(
      validateL2Row({
        receivedFromL1: 0,
        directLeads: 0,
        connected: 0,
        quoteSent: 0,
        closedWon: 0,
        closedLost: 0,
        disqualified: 0,
      }),
    ).toBeNull();
  });
  it("accepts outcomes that exceed today's received — follow-ups on prior-day leads", () => {
    // L2 closes 3 deals today, all of which came in last week.
    // Today's receivedFromL1 + directLeads = 0; the outcomes are
    // still valid.
    expect(
      validateL2Row({
        receivedFromL1: 0,
        directLeads: 0,
        connected: 5,
        quoteSent: 4,
        closedWon: 3,
        closedLost: 1,
        disqualified: 1,
      }),
    ).toBeNull();
  });
  it("rejects negative numbers", () => {
    expect(
      validateL2Row({
        receivedFromL1: -1,
        directLeads: 0,
        connected: 0,
        quoteSent: 0,
        closedWon: 0,
        closedLost: 0,
        disqualified: 0,
      }),
    ).toBe("negative");
  });
  it("rejects fractional numbers", () => {
    expect(
      validateL2Row({
        receivedFromL1: 2.5,
        directLeads: 0,
        connected: 0,
        quoteSent: 0,
        closedWon: 0,
        closedLost: 0,
        disqualified: 0,
      }),
    ).toBe("non_integer");
  });
});
