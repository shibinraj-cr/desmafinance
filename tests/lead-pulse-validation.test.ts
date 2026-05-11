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
  it("flags when outcomes exceed received", () => {
    expect(
      validateL1Row({ leadsReceived: 3, connectedCalls: 2, disqualified: 1, transferredToL2: 2 }),
    ).toBe("outcomes_exceed_received");
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
      }),
    ).toBeNull();
  });
  it("compares outcomes to received_from_l1 + direct combined", () => {
    expect(
      validateL2Row({
        receivedFromL1: 3,
        directLeads: 2,
        connected: 2,
        quoteSent: 1,
        closedWon: 1,
        closedLost: 1,
      }),
    ).toBeNull();
  });
  it("flags when outcomes exceed received_from_l1 + direct", () => {
    expect(
      validateL2Row({
        receivedFromL1: 1,
        directLeads: 1,
        connected: 2,
        quoteSent: 1,
        closedWon: 0,
        closedLost: 0,
      }),
    ).toBe("outcomes_exceed_received");
  });
});
