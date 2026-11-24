/**
 * Recording a collection against its plan: the pure rules (planChangeFor and
 * its sentences) and applyPaymentToPlan against an in-memory plan that
 * enforces (planId, seq) uniqueness after every write, as Postgres does.
 */
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { describePlanChange, planChangeFor, planChangeProblemMessage, type PlanInstalment } from "@/lib/collection-payment";
import {
  PlanChangeRefused,
  UndoRefused,
  applyPaymentToPlan,
  findDuplicatePayment,
  parseUndo,
  refKeys,
  undoPayment,
  utrFromDescription,
  utrKey,
} from "@/lib/collection-payment-server";

const inst = (id: string, seq: number, expectedDate: string, amount: number, status = "pending"): PlanInstalment => ({ id, seq, expectedDate, amount, status });

const PLAN = [
  inst("i1", 1, "2026-11-01", 50000, "received"),
  inst("i2", 2, "2026-12-15", 40000),
  inst("i3", 3, "2027-01-15", 40000),
  inst("i4", 4, "2027-02-15", 20000),
];

describe("planChangeFor", () => {
  it("paid exactly: just received", () => {
    expect(planChangeFor(PLAN, "i2", 40000)).toEqual({ received: { id: "i2", seq: 2, amount: 40000 }, rest: null, reduced: [], covered: [] });
  });

  it("paid less: the instalment becomes what was paid and the rest stays due on its date, right after it", () => {
    const c = planChangeFor(PLAN, "i2", 30000);
    expect(c).toEqual({ received: { id: "i2", seq: 2, amount: 30000 }, rest: { amount: 10000, expectedDate: "2026-12-15", seq: 3 }, reduced: [], covered: [] });
    expect(describePlanChange(c as never)).toEqual(["₹10,000 stays due on 15 Dec 2026 as instalment 3."]);
  });

  it("paid more: the extra pays the next instalments due, earliest first", () => {
    const c = planChangeFor(PLAN, "i2", 90000);
    expect(c).toEqual({
      received: { id: "i2", seq: 2, amount: 90000 },
      rest: null,
      covered: [{ id: "i3", seq: 3, amount: 40000 }],
      reduced: [{ id: "i4", seq: 4, from: 20000, to: 10000 }],
    });
    expect(describePlanChange(c as never)).toEqual([
      "Also pays instalment 3 (₹40,000) in full.",
      "Also pays ₹10,000 of instalment 4, leaving ₹10,000 due.",
    ]);
  });

  it("paid more on a later instalment: the overdue one is paid first", () => {
    const c = planChangeFor(PLAN, "i3", 50000);
    expect(c).toMatchObject({ reduced: [{ id: "i2", from: 40000, to: 30000 }], covered: [] });
  });

  it("leaves an instalment whose payment waits for approval alone", () => {
    const plan = [inst("i2", 2, "2026-12-15", 40000), inst("i3", 3, "2027-01-15", 40000, "submitted"), inst("i4", 4, "2027-02-15", 20000)];
    expect(planChangeFor(plan, "i2", 50000)).toMatchObject({ reduced: [{ id: "i4", to: 10000 }], covered: [] });
  });

  it("refuses more than the plan still has due, and says how much it can take", () => {
    const p = planChangeFor(PLAN, "i2", 100001);
    expect(p).toEqual({ error: "collection_more_than_due", maxAmount: 100000 });
    expect(planChangeProblemMessage(p as never)).toBe(
      "That's more than the ₹1,00,000 still due on this plan. Add an instalment for the extra first.",
    );
    expect(planChangeFor(PLAN, "i2", 100000)).not.toHaveProperty("error");
  });

  it("refuses an instalment already received or cancelled, and a zero amount", () => {
    expect(planChangeFor(PLAN, "i1", 50000)).toEqual({ error: "collection_not_due" });
    expect(planChangeFor([inst("x", 1, "2026-12-01", 100, "cancelled")], "x", 100)).toEqual({ error: "collection_not_due" });
    expect(planChangeFor(PLAN, "nope", 1)).toEqual({ error: "collection_not_due" });
    expect(planChangeFor(PLAN, "i2", 0)).toEqual({ error: "invalid_amount" });
    expect(planChangeFor(PLAN, "i2", Number.NaN)).toEqual({ error: "invalid_amount" });
  });

  it("works in paise without drift", () => {
    const plan = [inst("a", 1, "2026-12-01", 33333.33), inst("b", 2, "2027-01-01", 33333.33), inst("c", 3, "2027-02-01", 33333.34)];
    expect(planChangeFor(plan, "a", 50000)).toMatchObject({ reduced: [{ id: "b", from: 33333.33, to: 16666.66 }] });
    expect(planChangeFor(plan, "a", 12345.67)).toMatchObject({ rest: { amount: 20987.66 } });
  });
});

// ── applyPaymentToPlan against an in-memory plan ─────────────────────────────

type Row = {
  id: string;
  planId: string;
  seq: number;
  expectedDate: Date;
  amount: number;
  status: string;
  category: string | null;
  subItem: string | null;
  paymentMode: string | null;
  description: string | null;
  transactionId: string | null;
  pendingApprovalId: string | null;
  paymentUndo?: unknown;
};

const isSet = (v: unknown) => v != null && v !== Prisma.DbNull && v !== Prisma.JsonNull;

function fakeTx(rows: Row[], opts: { invoiced?: boolean } = {}) {
  let n = 0;
  const writes = { txUpdates: [] as unknown[], unlinked: [] as unknown[] };
  const unique = () => {
    const seen = new Set(rows.map((r) => `${r.planId}:${r.seq}`));
    if (seen.size !== rows.length) throw new Error("unique (planId, seq) violated");
  };
  const matches = (r: Row, where: { planId?: string; seq?: { gt: number }; paymentUndo?: unknown }) =>
    (where.planId === undefined || r.planId === where.planId) &&
    (where.seq === undefined || r.seq > where.seq.gt) &&
    (where.paymentUndo === undefined || isSet(r.paymentUndo));
  const locked: string[] = [];
  const db = {
    $queryRaw: async (_s: TemplateStringsArray, planId: string) => {
      locked.push(planId);
      return [];
    },
    invoice: { count: async () => (opts.invoiced ? 1 : 0) },
    transaction: { update: async (a: unknown) => writes.txUpdates.push(a) },
    pendingApproval: { updateMany: async (a: unknown) => writes.unlinked.push(a) },
    collectionPlanInstallment: {
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: { where: { planId: string; paymentUndo?: unknown } }) =>
        rows.filter((r) => matches(r, where)).sort((a, b) => a.seq - b.seq).map((r) => ({ ...r, amount: { toString: () => String(r.amount) } })),
      deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        for (const id of where.id.in) rows.splice(rows.findIndex((r) => r.id === id), 1);
      },
      // Applied row by row, checking uniqueness after each, as a non-deferred index does.
      updateMany: async ({ where, data }: { where: { planId: string; seq?: { gt: number } }; data: { seq: { increment?: number; decrement?: number } } }) => {
        for (const r of rows.filter((x) => matches(x, where)).sort((a, b) => b.seq - a.seq)) {
          r.seq += (data.seq.increment ?? 0) - (data.seq.decrement ?? 0);
          unique();
        }
      },
      create: async ({ data }: { data: Omit<Row, "id" | "transactionId" | "pendingApprovalId"> }) => {
        rows.push({ ...data, id: `new${++n}`, amount: Number(data.amount), transactionId: null, pendingApprovalId: null });
        unique();
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> & { expectedDate?: Date } }) => {
        Object.assign(rows.find((r) => r.id === where.id)!, data);
        unique();
      },
    },
  };
  return { db, rows, locked, writes };
}

const row = (id: string, seq: number, date: string, amount: number, status = "pending", description: string | null = null): Row => ({
  id,
  planId: "plan1",
  seq,
  expectedDate: new Date(`${date}T00:00:00.000Z`),
  amount,
  status,
  category: "Collection",
  subItem: "AHPRA",
  paymentMode: "HDFC Bank",
  description,
  transactionId: null,
  pendingApprovalId: null,
});

const planRows = () => [
  row("i1", 1, "2026-11-01", 50000, "received"),
  row("i2", 2, "2026-12-15", 40000, "submitted"),
  row("i3", 3, "2027-01-15", 40000, "pending", "Jan"),
  row("i4", 4, "2027-02-15", 20000),
];
const view = (rows: Row[]) =>
  rows
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((r) => [r.seq, r.id, r.amount, r.status, r.expectedDate.toISOString().slice(0, 10), r.description]);

describe("applyPaymentToPlan", () => {
  it("paid less: inserts the rest right after, renumbering later instalments without breaking (planId, seq)", async () => {
    const { db, rows, locked } = fakeTx(planRows());
    await applyPaymentToPlan(db as never, { instalmentId: "i2", transactionId: "tx9", paid: 25000 });
    // The plan, then its instalments.
    expect(locked).toEqual(["plan1", "plan1"]);
    expect(view(rows)).toEqual([
      [1, "i1", 50000, "received", "2026-11-01", null],
      [2, "i2", 25000, "received", "2026-12-15", null],
      [3, "new1", 15000, "pending", "2026-12-15", "Rest of instalment 2"],
      [4, "i3", 40000, "pending", "2027-01-15", "Jan"],
      [5, "i4", 20000, "pending", "2027-02-15", null],
    ]);
    const i2 = rows.find((r) => r.id === "i2")!;
    expect(i2.transactionId).toBe("tx9");
    expect(i2.pendingApprovalId).toBeNull();
    // The rest keeps the instalment's ledger picks.
    expect(rows.find((r) => r.id === "new1")).toMatchObject({ category: "Collection", subItem: "AHPRA", paymentMode: "HDFC Bank" });
  });

  it("paid more: covers and reduces the next instalments; the plan still adds up to the same", async () => {
    const { db, rows } = fakeTx(planRows());
    const before = rows.filter((r) => r.status !== "cancelled").reduce((s, r) => s + r.amount, 0);
    await applyPaymentToPlan(db as never, { instalmentId: "i2", transactionId: "tx9", paid: 90000 });
    expect(view(rows)).toEqual([
      [1, "i1", 50000, "received", "2026-11-01", null],
      [2, "i2", 90000, "received", "2026-12-15", null],
      [3, "i3", 40000, "cancelled", "2027-01-15", "Jan · Paid with instalment 2"],
      [4, "i4", 10000, "pending", "2027-02-15", null],
    ]);
    expect(rows.filter((r) => r.status !== "cancelled").reduce((s, r) => s + r.amount, 0)).toBe(before);
  });

  it("refuses, writing nothing, when the plan can't take it any more", async () => {
    const { db, rows } = fakeTx(planRows());
    const err = await applyPaymentToPlan(db as never, { instalmentId: "i2", transactionId: "tx9", paid: 100001 }).catch((e) => e);
    expect(err).toBeInstanceOf(PlanChangeRefused);
    expect(err.problem).toEqual({ error: "collection_more_than_due", maxAmount: 100000 });
    expect(view(rows)).toEqual(view(planRows()));
  });

  it("refuses an instalment that's gone", async () => {
    const { db } = fakeTx(planRows());
    const err = await applyPaymentToPlan(db as never, { instalmentId: "gone", transactionId: "tx9", paid: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(PlanChangeRefused);
    expect(err.problem).toEqual({ error: "collection_not_due" });
  });
});

// ── undo ─────────────────────────────────────────────────────────────────────

const viewPlain = (rows: Row[]) =>
  view(rows).map(([seq, id, amount, status, date, desc]) => [seq, id, amount, status === "submitted" ? "pending" : status, date, desc]);

describe("applyPaymentToPlan keeps what undo needs", () => {
  it("stores the plan just before and just after on the paid instalment", async () => {
    const { db, rows } = fakeTx(planRows());
    await applyPaymentToPlan(db as never, { instalmentId: "i2", transactionId: "tx9", paid: 25000 });
    const undo = parseUndo(rows.find((r) => r.id === "i2")!.paymentUndo)!;
    expect(undo).toMatchObject({ v: 1, linked: false, transactionId: "tx9" });
    expect(undo.before.map((r) => [r.seq, r.id, r.amount, r.status])).toEqual([
      [1, "i1", 50000, "received"],
      [2, "i2", 40000, "submitted"],
      [3, "i3", 40000, "pending"],
      [4, "i4", 20000, "pending"],
    ]);
    expect(undo.after.map((r) => r.id)).toEqual(["i1", "i2", "new1", "i3", "i4"]);
  });
});

describe("undoPayment", () => {
  it("puts a part payment back exactly: the rest is gone, seqs restored, the instalment due, the entry deleted", async () => {
    const { db, rows, writes } = fakeTx(planRows());
    await applyPaymentToPlan(db as never, { instalmentId: "i2", transactionId: "tx9", paid: 25000 });
    const out = await undoPayment(db as never, { instalmentId: "i2", userId: "fm" });
    expect(out).toEqual({ transactionId: "tx9", linked: false, planId: "plan1" });
    expect(view(rows)).toEqual(viewPlain(planRows()));
    const i2 = rows.find((r) => r.id === "i2")!;
    expect([i2.transactionId, i2.pendingApprovalId, isSet(i2.paymentUndo)]).toEqual([null, null, false]);
    expect(writes.txUpdates).toEqual([{ where: { id: "tx9" }, data: { deletedAt: expect.any(Date), deletedById: "fm" } }]);
    // An approved executive entry lets go of the instalment, so it can be recorded again.
    expect(writes.unlinked).toEqual([{ where: { collectionInstallmentId: "i2", status: { not: "pending" } }, data: { collectionInstallmentId: null } }]);
  });

  it("still matches a snapshot whose keys come back reordered (Postgres JSONB)", async () => {
    const { db, rows } = fakeTx(planRows());
    await applyPaymentToPlan(db as never, { instalmentId: "i2", transactionId: "tx9", paid: 25000 });
    const target = rows.find((r) => r.id === "i2")!;
    const u = target.paymentUndo as { after: Array<Record<string, unknown>> };
    const reorder = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());
    target.paymentUndo = { ...u, after: u.after.map(reorder) };
    await expect(undoPayment(db as never, { instalmentId: "i2", userId: "fm" })).resolves.toMatchObject({ transactionId: "tx9" });
  });

  it("puts an extra payment back: covered instalments due again, reduced ones whole", async () => {
    const { db, rows } = fakeTx(planRows());
    await applyPaymentToPlan(db as never, { instalmentId: "i2", transactionId: "tx9", paid: 90000 });
    await undoPayment(db as never, { instalmentId: "i2", userId: "fm" });
    expect(view(rows)).toEqual(viewPlain(planRows()));
  });

  it("a linked entry is only unlinked, never deleted", async () => {
    const { db, writes } = fakeTx(planRows(), { invoiced: true });
    await applyPaymentToPlan(db as never, { instalmentId: "i2", transactionId: "bank1", paid: 40000, linked: true });
    expect(await undoPayment(db as never, { instalmentId: "i2", userId: "fm" })).toMatchObject({ linked: true });
    expect(writes.txUpdates).toEqual([]);
  });

  it("refuses once the plan changed since, for a payment that isn't the latest, and for an invoiced entry", async () => {
    const a = fakeTx(planRows());
    await applyPaymentToPlan(a.db as never, { instalmentId: "i2", transactionId: "tx9", paid: 40000 });
    a.rows.find((r) => r.id === "i4")!.amount = 25000; // edited afterwards
    await expect(undoPayment(a.db as never, { instalmentId: "i2", userId: "fm" })).rejects.toMatchObject({ problem: "plan_changed" });

    const b = fakeTx(planRows());
    await applyPaymentToPlan(b.db as never, { instalmentId: "i2", transactionId: "tx9", paid: 40000 });
    await new Promise((r) => setTimeout(r, 2));
    await applyPaymentToPlan(b.db as never, { instalmentId: "i3", transactionId: "tx10", paid: 40000 });
    await expect(undoPayment(b.db as never, { instalmentId: "i2", userId: "fm" })).rejects.toMatchObject({ problem: "not_latest" });
    await undoPayment(b.db as never, { instalmentId: "i3", userId: "fm" });
    await undoPayment(b.db as never, { instalmentId: "i2", userId: "fm" });
    expect(view(b.rows)).toEqual(viewPlain(planRows()));

    const c = fakeTx(planRows(), { invoiced: true });
    await applyPaymentToPlan(c.db as never, { instalmentId: "i2", transactionId: "tx9", paid: 40000 });
    const err = await undoPayment(c.db as never, { instalmentId: "i2", userId: "fm" }).catch((e) => e);
    expect(err).toBeInstanceOf(UndoRefused);
    expect(err.problem).toBe("invoiced");
  });

  it("refuses an instalment with nothing recorded through Record payment", async () => {
    const { db } = fakeTx(planRows());
    await expect(undoPayment(db as never, { instalmentId: "i1", userId: "fm" })).rejects.toMatchObject({ problem: "not_undoable" });
  });
});

// ── the same payment twice ───────────────────────────────────────────────────

describe("UTR matching", () => {
  it("compares references by their letters and digits", () => {
    expect(utrKey(" hdfc-0000 123456 ")).toBe("HDFC0000123456");
    expect(utrKey("0012")).toBeNull(); // too short once leading zeros go
    expect(refKeys("Balance · instalment 2 · UTR HDFC0000123456 · paid by X").has("HDFC0000123456")).toBe(true);
    expect(refKeys("NEFT-HDFC0000123456-TEST NAME").has("HDFC0000123456")).toBe(true);
    expect(refKeys("Ref AXIS99887766").has("AXIS99887766")).toBe(true);
    expect(refKeys("UTR HDFC00001234567").has("HDFC0000123456")).toBe(false);
    expect(utrFromDescription("Plan · instalment 2 · UTR HDFCA1-FIXED · paid by X")).toBe("HDFCA1-FIXED");
    expect(utrFromDescription("Second instalment")).toBeNull();
  });

  it("finds the candidate's live entry carrying it, and says whether it's already a plan payment", async () => {
    const db = {
      transaction: {
        findMany: async () => [
          { id: "t1", date: new Date("2026-11-02T00:00:00Z"), amount: { toString: () => "30000" }, description: "Other", collectionInstallment: null, bankMatches: [] },
          { id: "t2", date: new Date("2026-11-03T00:00:00Z"), amount: { toString: () => "20000" }, description: "Ref AXIS99887766", collectionInstallment: { id: "i9" }, bankMatches: [] },
        ],
      },
      pendingApproval: { findMany: async () => [] },
    };
    expect(await findDuplicatePayment(db as never, { partyId: "p1", utr: "axis 99887766" })).toEqual({
      source: "ledger",
      id: "t2",
      date: "2026-11-03",
      amount: 20000,
      description: "Ref AXIS99887766",
      linked: true,
    });
    expect(await findDuplicatePayment(db as never, { partyId: "p1", utr: "AXIS11112222" })).toBeNull();
    expect(await findDuplicatePayment(db as never, { partyId: "p1", utr: null })).toBeNull();
  });
});
