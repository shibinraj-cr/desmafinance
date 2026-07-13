/**
 * Tests for the shared transaction validator (src/lib/finance-tx-validation.ts).
 *
 * This function is the single gate every transaction write path runs through —
 * create, edit, rejected-resubmit, and draft-edit — so pinning its rules here
 * proves all four paths reject the same bad input (zero amount, unknown
 * category, invalid enum, missing EXP/DOM …) and that `month` is always
 * derived from `date` rather than trusted from the client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// buildValidatedProposed calls into these two async validators; mock them so we
// can drive their verdicts and isolate the enum/amount/month logic.
vi.mock("@/lib/master-data", () => ({
  verifyCategorySubItem: vi.fn(async () => null),
}));
vi.mock("@/lib/tx-counterparty", () => ({
  validateCounterparty: vi.fn(async () => null),
}));

import { buildValidatedProposed } from "@/lib/finance-tx-validation";
import { verifyCategorySubItem } from "@/lib/master-data";
import { validateCounterparty } from "@/lib/tx-counterparty";

const verifyCat = verifyCategorySubItem as unknown as ReturnType<typeof vi.fn>;
const verifyCp = validateCounterparty as unknown as ReturnType<typeof vi.fn>;

/** A valid Revenue payload; individual tests override single fields. */
function revenue(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-07-15",
    type: "Revenue",
    category: "Sales - Nursing Registrations",
    subItem: "AHPRA OBA Pathway (Sales)",
    description: null,
    paymentMode: "HDFC Bank",
    amount: 1000,
    flow: "Inflow",
    partyId: "party1",
    employeeId: null,
    expDom: "DOM",
    ...overrides,
  } as Parameters<typeof buildValidatedProposed>[0];
}

beforeEach(() => {
  verifyCat.mockReset();
  verifyCp.mockReset();
  verifyCat.mockResolvedValue(null);
  verifyCp.mockResolvedValue(null);
});

describe("buildValidatedProposed — month derivation", () => {
  it("derives month from the date and ignores any client-supplied month", async () => {
    // Even though the input carries a bogus `month`, it is stripped before this
    // function; here we just prove the derived value tracks the date.
    const res = await buildValidatedProposed(revenue({ date: "2026-07-15" }));
    expect("proposed" in res && res.proposed.month).toBe("Jul-26");
  });

  it("maps a December date to the right code", async () => {
    const res = await buildValidatedProposed(revenue({ date: "2026-12-01" }));
    expect("proposed" in res && res.proposed.month).toBe("Dec-26");
  });

  it("rejects a date outside the tracked reporting window", async () => {
    const res = await buildValidatedProposed(revenue({ date: "2030-01-01" }));
    expect(res).toEqual({ error: "month_out_of_range" });
  });

  it("rejects an unparseable date", async () => {
    const res = await buildValidatedProposed(revenue({ date: "not-a-date" }));
    expect(res).toEqual({ error: "invalid_date" });
  });
});

describe("buildValidatedProposed — amount", () => {
  it("rejects a zero amount (blocks zero-amount resubmits)", async () => {
    const res = await buildValidatedProposed(revenue({ amount: 0 }));
    expect(res).toEqual({ error: "invalid_amount" });
  });

  it("rejects a negative amount", async () => {
    const res = await buildValidatedProposed(revenue({ amount: -5 }));
    expect(res).toEqual({ error: "invalid_amount" });
  });

  it("rejects a non-finite amount", async () => {
    const res = await buildValidatedProposed(revenue({ amount: Number.NaN }));
    expect(res).toEqual({ error: "invalid_amount" });
  });

  it("accepts a positive amount", async () => {
    const res = await buildValidatedProposed(revenue({ amount: 250 }));
    expect("proposed" in res && res.proposed.amount).toBe(250);
  });
});

describe("buildValidatedProposed — enums", () => {
  it("rejects an invalid type", async () => {
    const res = await buildValidatedProposed(revenue({ type: "Wibble" }));
    expect(res).toEqual({ error: "invalid_type" });
  });

  it("rejects an invalid payment mode", async () => {
    const res = await buildValidatedProposed(revenue({ paymentMode: "Bitcoin" }));
    expect(res).toEqual({ error: "invalid_payment_mode" });
  });

  it("rejects an invalid flow", async () => {
    const res = await buildValidatedProposed(revenue({ flow: "Sideways" }));
    expect(res).toEqual({ error: "invalid_flow" });
  });

  it("derives flow from type when the client omits it", async () => {
    const res = await buildValidatedProposed(revenue({ flow: null }));
    expect("proposed" in res && res.proposed.flow).toBe("Inflow");
  });

  it("derives Outflow for an Expense", async () => {
    const res = await buildValidatedProposed(
      revenue({ type: "Expense", flow: undefined, expDom: null, category: "Rent", subItem: "Rent" }),
    );
    expect("proposed" in res && res.proposed.flow).toBe("Outflow");
  });
});

describe("buildValidatedProposed — category / sub-item master", () => {
  it("surfaces an unknown category from the master check", async () => {
    verifyCat.mockResolvedValue("category_not_found");
    const res = await buildValidatedProposed(revenue({ category: "Ghost Category" }));
    expect(res).toEqual({ error: "category_not_found" });
  });

  it("surfaces an unknown sub-item from the master check", async () => {
    verifyCat.mockResolvedValue("sub_item_not_found");
    const res = await buildValidatedProposed(revenue({ subItem: "Ghost Sub" }));
    expect(res).toEqual({ error: "sub_item_not_found" });
  });

  it("passes the (category, subItem, type) triple to the master check", async () => {
    await buildValidatedProposed(revenue());
    expect(verifyCat).toHaveBeenCalledWith(
      "Sales - Nursing Registrations",
      "AHPRA OBA Pathway (Sales)",
      "Revenue",
    );
  });
});

describe("buildValidatedProposed — EXP/DOM", () => {
  it("requires EXP/DOM on Revenue", async () => {
    const res = await buildValidatedProposed(revenue({ expDom: null }));
    expect(res).toEqual({ error: "expDom_required" });
  });

  it("forces EXP/DOM to null on Expense even if one is supplied", async () => {
    const res = await buildValidatedProposed(
      revenue({ type: "Expense", category: "Rent", subItem: "Rent", expDom: "EXP", partyId: "vendor1" }),
    );
    expect("proposed" in res && res.proposed.expDom).toBeNull();
  });

  it("keeps a valid EXP/DOM on Revenue", async () => {
    const res = await buildValidatedProposed(revenue({ expDom: "EXP" }));
    expect("proposed" in res && res.proposed.expDom).toBe("EXP");
  });
});

describe("buildValidatedProposed — counterparty", () => {
  it("surfaces a counterparty error", async () => {
    verifyCp.mockResolvedValue("counterparty_required");
    const res = await buildValidatedProposed(revenue({ partyId: null, employeeId: null }));
    expect(res).toEqual({ error: "counterparty_required" });
  });

  it("returns a fully normalised proposal on the happy path", async () => {
    const res = await buildValidatedProposed(revenue());
    expect(res).toEqual({
      proposed: {
        date: "2026-07-15",
        month: "Jul-26",
        type: "Revenue",
        category: "Sales - Nursing Registrations",
        subItem: "AHPRA OBA Pathway (Sales)",
        description: null,
        paymentMode: "HDFC Bank",
        amount: 1000,
        flow: "Inflow",
        partyId: "party1",
        employeeId: null,
        expDom: "DOM",
      },
    });
  });
});
