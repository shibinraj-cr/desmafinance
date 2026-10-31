import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { buildProfitStatement, isDirectorSalary, type ProfitRow } from "@/lib/ceo-dashboard";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const from = d("2026-10-01");
const to = d("2026-11-01");

function row(over: Partial<ProfitRow>): ProfitRow {
  return {
    date: d("2026-10-15"),
    type: "Expense",
    category: "Rent",
    subItem: "Rent",
    amount: 100,
    ...over,
  };
}

describe("isDirectorSalary", () => {
  it("recognises today's catalog entry, Salary → Directors", () => {
    expect(isDirectorSalary(row({ category: "Salary", subItem: "Directors" }))).toBe(true);
  });

  it("recognises the top-level Directors category retired in May 2026", () => {
    expect(isDirectorSalary(row({ category: "Directors", subItem: "Directors" }))).toBe(true);
  });

  it("recognises another Salary sub-item paid to an owner", () => {
    for (const employeeDesignation of ["Managing Director", "Director", " director "]) {
      expect(
        isDirectorSalary(row({ category: "Salary", subItem: "Senior Team", employeeDesignation })),
      ).toBe(true);
    }
  });

  it("ignores case and stray spaces in the stored strings", () => {
    expect(isDirectorSalary(row({ category: " salary ", subItem: "DIRECTORS " }))).toBe(true);
  });

  it("leaves staff salary alone", () => {
    expect(
      isDirectorSalary(
        row({ category: "Salary", subItem: "Sales Team", employeeDesignation: "Sales Manager" }),
      ),
    ).toBe(false);
    expect(isDirectorSalary(row({ category: "Salary", subItem: "Operational Team" }))).toBe(false);
  });

  it("leaves a Director's non-salary expense alone", () => {
    expect(
      isDirectorSalary(
        row({
          category: "Travel & Transportation",
          subItem: "Fuel",
          employeeDesignation: "Managing Director",
        }),
      ),
    ).toBe(false);
  });

  it("never treats revenue as salary", () => {
    expect(isDirectorSalary(row({ type: "Revenue", category: "Directors" }))).toBe(false);
  });
});

describe("buildProfitStatement", () => {
  it("is income less expenses, with Director's Salary on its own line", () => {
    const s = buildProfitStatement(
      [
        row({ type: "Revenue", category: "Sales - AHPRA", amount: 1_000_000 }),
        row({ type: "Revenue", category: "Collection - AHPRA", amount: 500_000 }),
        row({ category: "Rent", amount: 200_000 }),
        row({ category: "Salary", subItem: "Sales Team", amount: 300_000 }),
        row({ category: "Salary", subItem: "Directors", amount: 150_000 }),
        row({ category: "Directors", subItem: "Directors", amount: 50_000 }),
      ],
      from,
      to,
    );
    expect(s).toEqual({
      income: 1_500_000,
      expenses: 500_000,
      profit: 1_000_000,
      directorSalary: 200_000,
      profitAfterDirectorSalary: 800_000,
    });
  });

  it("counts refunds, asset purchases and loan repayments as expenses", () => {
    const s = buildProfitStatement(
      [
        row({ type: "Revenue", category: "Sales - AHPRA", amount: 1_000 }),
        row({ category: "Refund", subItem: "Refund", amount: 100 }),
        row({ category: "Buying Assets", subItem: "Buying Assets", amount: 200 }),
        row({ category: "Loan Repayment", subItem: "Loan Repayment", amount: 300 }),
      ],
      from,
      to,
    );
    expect(s.expenses).toBe(600);
    expect(s.profit).toBe(400);
  });

  it("includes the first day and excludes the end of the range", () => {
    const s = buildProfitStatement(
      [
        row({ type: "Revenue", category: "Sales", date: d("2026-09-30"), amount: 1 }),
        row({ type: "Revenue", category: "Sales", date: d("2026-10-01"), amount: 10 }),
        row({ type: "Revenue", category: "Sales", date: d("2026-10-31"), amount: 100 }),
        row({ type: "Revenue", category: "Sales", date: d("2026-11-01"), amount: 1_000 }),
      ],
      from,
      to,
    );
    expect(s.income).toBe(110);
  });

  it("goes negative on a loss, and is all zeros with no rows", () => {
    const loss = buildProfitStatement(
      [
        row({ type: "Revenue", category: "Sales", amount: 100 }),
        row({ category: "Rent", amount: 150 }),
        row({ category: "Salary", subItem: "Directors", amount: 25 }),
      ],
      from,
      to,
    );
    expect(loss.profit).toBe(-50);
    expect(loss.profitAfterDirectorSalary).toBe(-75);

    expect(buildProfitStatement([], from, to)).toEqual({
      income: 0,
      expenses: 0,
      profit: 0,
      directorSalary: 0,
      profitAfterDirectorSalary: 0,
    });
  });
});
