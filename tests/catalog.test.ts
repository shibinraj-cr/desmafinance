import { describe, it, expect } from "vitest";
import {
  TYPES,
  FLOWS,
  PAYMENT_MODES,
  MONTHS,
  REVENUE_CATEGORIES,
  EXPENSE_CATEGORIES,
  categoriesFor,
  subItemsFor,
  flowFor,
} from "@/lib/catalog";

describe("catalog enums", () => {
  it("Type and Flow are exactly two values each", () => {
    expect(TYPES).toEqual(["Revenue", "Expense"]);
    expect(FLOWS).toEqual(["Inflow", "Outflow"]);
  });

  it("Months are exactly 12 ordered Apr→Mar", () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toBe("Apr-26");
    expect(MONTHS[11]).toBe("Mar-27");
  });

  it("Payment modes include the banks used in the source spreadsheet", () => {
    expect(PAYMENT_MODES).toContain("HDFC Bank");
    expect(PAYMENT_MODES).toContain("Axis Bank");
    expect(PAYMENT_MODES).toContain("Wio Bank");
  });
});

describe("flowFor", () => {
  it("Revenue → Inflow, Expense → Outflow", () => {
    expect(flowFor("Revenue")).toBe("Inflow");
    expect(flowFor("Expense")).toBe("Outflow");
  });
});

describe("categoriesFor", () => {
  it("returns revenue categories for Revenue", () => {
    expect(categoriesFor("Revenue")).toEqual(REVENUE_CATEGORIES);
  });

  it("returns expense categories for Expense", () => {
    expect(categoriesFor("Expense")).toEqual(EXPENSE_CATEGORIES);
  });
});

describe("subItemsFor", () => {
  it("returns the sub-items for known revenue categories", () => {
    const subs = subItemsFor("Revenue", "Sales - Nursing Registrations");
    expect(subs).toContain("AHPRA OBA Pathway (Sales)");
    expect(subs).toContain("ANMAC Skills Assessment (Sales)");
  });

  it("returns the sub-items for known expense categories", () => {
    const subs = subItemsFor("Expense", "Marketing");
    expect(subs).toContain("Digital Advertisement - Meta");
    expect(subs).toContain("Digital Advertisement - Google");
  });

  it("falls back to [category] for unknown categories so the form never crashes", () => {
    expect(subItemsFor("Revenue", "Mystery Category")).toEqual(["Mystery Category"]);
  });
});

describe("catalog integrity", () => {
  it("every revenue category has at least one sub-item defined or maps to itself", () => {
    for (const c of REVENUE_CATEGORIES) {
      const subs = subItemsFor("Revenue", c);
      expect(subs.length).toBeGreaterThan(0);
    }
  });

  it("every expense category has at least one sub-item defined or maps to itself", () => {
    for (const c of EXPENSE_CATEGORIES) {
      const subs = subItemsFor("Expense", c);
      expect(subs.length).toBeGreaterThan(0);
    }
  });
});
