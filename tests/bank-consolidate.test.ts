import { describe, expect, it } from "vitest";
import { consolidate, coverageGaps, type ConsolidatedRow } from "@/lib/bank/consolidate";

const row = (id: string, txnDate: string, debit: number, credit: number, balance: number): ConsolidatedRow => ({
  id,
  txnDate,
  debit,
  credit,
  balance,
  description: id,
});

describe("consolidated statement", () => {
  it("derives opening/closing and reconciles a continuous ledger", () => {
    const s = consolidate(
      [row("a", "2026-10-01", 1000, 0, 99000), row("b", "2026-10-02", 0, 5000, 104000), row("c", "2026-10-03", 4000, 0, 100000)],
      [{ start: "2026-10-01", end: "2026-10-03" }],
      { from: null, to: null },
    );
    expect(s).toMatchObject({ opening: 100000, closing: 100000, totalDebit: 5000, totalCredit: 5000, reconciles: true, breaks: [], gaps: [] });
  });

  it("flags a balance break where transactions are missing between statements", () => {
    const s = consolidate(
      [row("a", "2026-10-01", 1000, 0, 99000), row("b", "2026-10-05", 0, 1000, 150000)],
      [{ start: "2026-10-01", end: "2026-10-01" }, { start: "2026-10-05", end: "2026-10-05" }],
      { from: null, to: null },
    );
    expect(s.breaks).toEqual([{ id: "b", date: "2026-10-05", expected: 100000, actual: 150000, description: "b" }]);
    expect(s.reconciles).toBe(false);
    expect(s.gaps).toEqual([{ start: "2026-10-02", end: "2026-10-04" }]);
  });

  it("finds coverage gaps, merging overlapping statements", () => {
    expect(
      coverageGaps(
        [
          { start: "2026-10-01", end: "2026-10-10" },
          { start: "2026-10-05", end: "2026-10-12" }, // overlaps
          { start: "2026-10-20", end: "2026-10-31" },
        ],
        { from: "2026-09-28", to: "2026-11-02" },
      ),
    ).toEqual([
      { start: "2026-09-28", end: "2026-09-30" },
      { start: "2026-10-13", end: "2026-10-19" },
      { start: "2026-11-01", end: "2026-11-02" },
    ]);
  });

  it("has nothing to say about an empty account", () => {
    expect(consolidate([], [], { from: null, to: null })).toMatchObject({ count: 0, opening: null, closing: null, reconciles: null, gaps: [] });
  });
});
