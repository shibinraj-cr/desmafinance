import { describe, it, expect } from "vitest";
import {
  HISTORICAL_FROM_ISO,
  HISTORICAL_TO_ISO,
  LEDGER_GO_LIVE_ISO,
  isBeforeHistoricalFloor,
  isCandidatePaymentCategory,
  isHistoricalDate,
} from "@/lib/finance-historical";
import { FY_START } from "@/lib/period";

describe("isHistoricalDate", () => {
  it("is true up to the last day before DesGro's books began", () => {
    expect(isHistoricalDate(HISTORICAL_TO_ISO)).toBe(true);
    expect(isHistoricalDate("2026-03-31T23:59:59.999Z")).toBe(true);
    expect(isHistoricalDate(new Date(Date.UTC(2024, 6, 1)))).toBe(true);
  });

  it("is false from the first day of the live ledger", () => {
    expect(isHistoricalDate(LEDGER_GO_LIVE_ISO)).toBe(false);
    expect(isHistoricalDate("2026-04-01T00:00:00.000Z")).toBe(false);
    expect(isHistoricalDate("2026-11-17")).toBe(false);
  });

  it("matches the start of the financial year the reports cover", () => {
    expect(isHistoricalDate(FY_START)).toBe(false);
    expect(isHistoricalDate(new Date(FY_START.getTime() - 1))).toBe(true);
  });

  it("treats an empty or unparseable date as not historical", () => {
    expect(isHistoricalDate("")).toBe(false);
    expect(isHistoricalDate("not-a-date")).toBe(false);
  });
});

describe("isBeforeHistoricalFloor", () => {
  it("accepts 1 Apr 2023 and refuses the day before", () => {
    expect(isBeforeHistoricalFloor(HISTORICAL_FROM_ISO)).toBe(false);
    expect(isBeforeHistoricalFloor("2023-03-31")).toBe(true);
  });
});

describe("isCandidatePaymentCategory", () => {
  it("allows Sales and Collection categories only", () => {
    expect(isCandidatePaymentCategory("Sales - Nursing Registrations")).toBe(true);
    expect(isCandidatePaymentCategory("Collection - Study Abroad")).toBe(true);
    expect(isCandidatePaymentCategory("Commissions")).toBe(false);
    expect(isCandidatePaymentCategory("Refund")).toBe(false);
  });
});
