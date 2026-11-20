import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  party: { findMany: vi.fn() },
  transaction: { groupBy: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { buildCandidateTotals, loadCandidateTotals } from "@/lib/candidate-totals";

const dec = (n: number) => ({ toString: () => String(n) });

describe("buildCandidateTotals", () => {
  it("sums services, takes approved payments, and works out the balance", () => {
    const out = buildCandidateTotals(
      [
        { id: "c1", partyServices: [{ totalAmount: dec(150000) }, { totalAmount: dec(25000.5) }] },
        { id: "c2", partyServices: [] },
      ],
      [
        { partyId: "c1", _sum: { amount: dec(68440) } },
        { partyId: "c2", _sum: { amount: dec(20000) } },
      ],
    );
    expect(out.c1).toEqual({ quoted: 175000.5, paid: 68440, balance: 106560.5, services: 2 });
    // No service set: quoted 0, so the balance goes negative and the UI says "Not set".
    expect(out.c2).toEqual({ quoted: 0, paid: 20000, balance: -20000, services: 0 });
  });

  it("a candidate with nothing paid yet owes the full total", () => {
    const out = buildCandidateTotals([{ id: "c1", partyServices: [{ totalAmount: 90000 }] }], []);
    expect(out.c1).toEqual({ quoted: 90000, paid: 0, balance: 90000, services: 1 });
  });

  it("ignores a null party bucket and a null sum", () => {
    const out = buildCandidateTotals(
      [{ id: "c1", partyServices: [{ totalAmount: dec(1000) }] }],
      [
        { partyId: null, _sum: { amount: dec(999) } },
        { partyId: "c1", _sum: { amount: null } },
      ],
    );
    expect(out.c1.paid).toBe(0);
  });
});

describe("loadCandidateTotals", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips the queries when no row has a party", async () => {
    expect(await loadCandidateTotals(["", ""])).toEqual({});
    expect(db.party.findMany).not.toHaveBeenCalled();
  });

  it("asks only for Candidates, and counts approved Revenue including pre-DesGro payments", async () => {
    db.party.findMany.mockResolvedValue([{ id: "c1", partyServices: [{ totalAmount: dec(100) }] }]);
    db.transaction.groupBy.mockResolvedValue([{ partyId: "c1", _sum: { amount: dec(40) } }]);

    const out = await loadCandidateTotals(["c1", "v1", "c1", ""]);

    expect(db.party.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["c1", "v1"] },
      group: "Candidate",
    });
    const where = db.transaction.groupBy.mock.calls[0][0].where;
    expect(where).toEqual({ partyId: { in: ["c1"] }, type: "Revenue", deletedAt: null });
    // The candidate page's balance includes payments from before DesGro; so must this.
    expect(where).not.toHaveProperty("isHistorical");
    expect(out).toEqual({ c1: { quoted: 100, paid: 40, balance: 60, services: 1 } });
  });

  it("skips the ledger read when none of the parties is a Candidate", async () => {
    db.party.findMany.mockResolvedValue([]);
    expect(await loadCandidateTotals(["v1"])).toEqual({});
    expect(db.transaction.groupBy).not.toHaveBeenCalled();
  });
});
