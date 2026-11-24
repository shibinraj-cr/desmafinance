/**
 * Applies a recorded collection to its plan, inside the database transaction
 * that posts the ledger entry (the Collection Plan route for an approver, or
 * approvePending for an executive's entry). The rules are planChangeFor's in
 * src/lib/collection-payment.ts, so the dialog's preview is what happens.
 *
 * Every payment applied here keeps the plan's instalments as they were just
 * before and just after (`paymentUndo` on the paid instalment), so the most
 * recent payment can be undone exactly while nothing else on the plan has
 * changed since (undoPayment).
 */
import { Prisma } from "@prisma/client";
import { fromPrismaDate, toPrismaDate } from "./lead-pulse-dates";
import { planChangeFor, type PlanChange, type PlanChangeProblem } from "./collection-payment";
import { lockLedgerRow } from "./invoices/ledger-lock";

/** The plan can't take this payment as it stands now; nothing was written. */
export class PlanChangeRefused extends Error {
  constructor(readonly problem: PlanChangeProblem) {
    super(problem.error);
    this.name = "PlanChangeRefused";
  }
}

/** Above every real seq: later instalments park here while one is inserted. */
const SEQ_PARK = 100_000;

export async function loadPlanInstalments(db: Prisma.TransactionClient, planId: string) {
  const rows = await db.collectionPlanInstallment.findMany({
    where: { planId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, expectedDate: true, amount: true, status: true, category: true, subItem: true, paymentMode: true, description: true },
  });
  return rows.map((r) => ({ ...r, expectedDate: fromPrismaDate(r.expectedDate), amount: Number(r.amount.toString()) }));
}

/**
 * Lock the plan, then its instalments, until the transaction ends: payments,
 * undo and "Add instalment" on one plan run one after the other. Always plan
 * first, so they can't deadlock each other.
 */
export async function lockPlan(tx: Prisma.TransactionClient, planId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "CollectionPlan" WHERE id = ${planId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "CollectionPlanInstallment" WHERE "planId" = ${planId} FOR UPDATE`;
}

/** One instalment as an undo snapshot holds it. */
export type PlanRowSnapshot = {
  id: string;
  seq: number;
  expectedDate: string;
  amount: number;
  status: string;
  description: string | null;
  transactionId: string | null;
  pendingApprovalId: string | null;
};

/** Kept on the paid instalment: what undoing this payment puts back. */
export type PaymentUndo = {
  v: 1;
  /** When it was recorded (ISO); the latest on a plan is the one that can be undone. */
  at: string;
  /** The ledger entry already existed and was only linked: undo unlinks it, never deletes it. */
  linked: boolean;
  transactionId: string;
  before: PlanRowSnapshot[];
  after: PlanRowSnapshot[];
};

async function snapshotPlan(db: Prisma.TransactionClient, planId: string): Promise<PlanRowSnapshot[]> {
  const rows = await db.collectionPlanInstallment.findMany({
    where: { planId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, expectedDate: true, amount: true, status: true, description: true, transactionId: true, pendingApprovalId: true },
  });
  return rows
    .map((r) => ({
      id: r.id,
      seq: r.seq,
      expectedDate: fromPrismaDate(r.expectedDate),
      amount: Number(r.amount.toString()),
      status: r.status,
      description: r.description ?? null,
      transactionId: r.transactionId ?? null,
      pendingApprovalId: r.pendingApprovalId ?? null,
    }))
    .sort((a, b) => a.seq - b.seq);
}

/** Same instalments, field by field (the stored JSON comes back with its keys reordered). */
const sameRows = (a: PlanRowSnapshot[], b: PlanRowSnapshot[]) => {
  const key = (rows: PlanRowSnapshot[]) =>
    JSON.stringify(
      [...rows]
        .sort((x, y) => x.id.localeCompare(y.id))
        .map((r) => [r.id, r.seq, r.expectedDate, Number(r.amount), r.status, r.description ?? null, r.transactionId ?? null, r.pendingApprovalId ?? null]),
    );
  return key(a) === key(b);
};

export function parseUndo(v: unknown): PaymentUndo | null {
  const u = v as PaymentUndo | null;
  return u && typeof u === "object" && u.v === 1 && Array.isArray(u.before) && Array.isArray(u.after) && typeof u.at === "string" ? u : null;
}

/**
 * Marks the instalment received for `paid`, linked to the ledger entry, and
 * reshapes the rest of the plan (see planChangeFor). Locks the plan first, so
 * two payments recorded on one plan at once reshape it one after the other.
 * Throws PlanChangeRefused when the payment no longer fits (e.g. another
 * instalment was received meanwhile).
 */
export async function applyPaymentToPlan(
  tx: Prisma.TransactionClient,
  input: { instalmentId: string; transactionId: string; paid: number; linked?: boolean },
): Promise<PlanChange> {
  const own = await tx.collectionPlanInstallment.findUnique({ where: { id: input.instalmentId }, select: { planId: true } });
  if (!own) throw new PlanChangeRefused({ error: "collection_not_due" });
  const planId = own.planId;
  await lockPlan(tx, planId);

  const before = await snapshotPlan(tx, planId);
  const rows = await loadPlanInstalments(tx, planId);
  const change = planChangeFor(rows, input.instalmentId, input.paid);
  if ("error" in change) throw new PlanChangeRefused(change);
  const target = rows.find((r) => r.id === input.instalmentId)!;

  if (change.rest) {
    // Make room right after the paid instalment, in two moves so (planId, seq)
    // stays unique at every row: park the later ones high, then bring them
    // back one place down the list.
    await tx.collectionPlanInstallment.updateMany({ where: { planId, seq: { gt: target.seq } }, data: { seq: { increment: SEQ_PARK } } });
    await tx.collectionPlanInstallment.updateMany({ where: { planId, seq: { gt: SEQ_PARK } }, data: { seq: { decrement: SEQ_PARK - 1 } } });
    await tx.collectionPlanInstallment.create({
      data: {
        planId,
        seq: change.rest.seq,
        expectedDate: toPrismaDate(change.rest.expectedDate),
        amount: change.rest.amount,
        category: target.category,
        subItem: target.subItem,
        paymentMode: target.paymentMode,
        description: `Rest of instalment ${target.seq}`,
        status: "pending",
      },
    });
  }
  for (const r of change.reduced) {
    await tx.collectionPlanInstallment.update({ where: { id: r.id }, data: { amount: r.to } });
  }
  for (const c of change.covered) {
    const was = rows.find((r) => r.id === c.id)?.description?.trim();
    await tx.collectionPlanInstallment.update({
      where: { id: c.id },
      data: { status: "cancelled", description: [was, `Paid with instalment ${target.seq}`].filter(Boolean).join(" · ") },
    });
  }
  await tx.collectionPlanInstallment.update({
    where: { id: input.instalmentId },
    data: { status: "received", amount: change.received.amount, transactionId: input.transactionId, pendingApprovalId: null },
  });
  const undo: PaymentUndo = {
    v: 1,
    at: new Date().toISOString(),
    linked: !!input.linked,
    transactionId: input.transactionId,
    before,
    after: await snapshotPlan(tx, planId),
  };
  await tx.collectionPlanInstallment.update({
    where: { id: input.instalmentId },
    data: { paymentUndo: undo as unknown as Prisma.InputJsonValue },
  });
  return change;
}

// ── undo ─────────────────────────────────────────────────────────────────────

export type UndoProblem = "not_undoable" | "not_latest" | "plan_changed" | "invoiced";

export class UndoRefused extends Error {
  constructor(readonly problem: UndoProblem) {
    super(problem);
    this.name = "UndoRefused";
  }
}

/**
 * Undo the plan's most recent recorded payment: the plan goes back exactly to
 * how it was before it, and the ledger entry it posted is deleted (soft, as
 * the ledger deletes) — or, for a linked entry, just unlinked. Refused when
 * anything on the plan changed since (a later payment, an instalment added,
 * edited or removed), or when the entry has a live invoice (cancel it first).
 */
export async function undoPayment(
  tx: Prisma.TransactionClient,
  input: { instalmentId: string; userId: string },
): Promise<{ transactionId: string; linked: boolean; planId: string }> {
  const own = await tx.collectionPlanInstallment.findUnique({ where: { id: input.instalmentId }, select: { planId: true } });
  if (!own) throw new UndoRefused("not_undoable");
  const planId = own.planId;
  await lockPlan(tx, planId);

  const target = await tx.collectionPlanInstallment.findUnique({
    where: { id: input.instalmentId },
    select: { status: true, transactionId: true, paymentUndo: true },
  });
  const undo = parseUndo(target?.paymentUndo);
  if (!target || target.status !== "received" || !undo || undo.transactionId !== target.transactionId) throw new UndoRefused("not_undoable");

  // Only the latest payment on the plan.
  const recorded = await tx.collectionPlanInstallment.findMany({
    where: { planId, paymentUndo: { not: Prisma.AnyNull } },
    select: { id: true, paymentUndo: true },
  });
  const latest = recorded
    .map((r) => ({ id: r.id, at: parseUndo(r.paymentUndo)?.at ?? "" }))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  if (latest && latest.id !== input.instalmentId) throw new UndoRefused("not_latest");

  // Nothing else on the plan may have changed since.
  if (!sameRows(await snapshotPlan(tx, planId), undo.after)) throw new UndoRefused("plan_changed");

  if (!undo.linked) {
    await lockLedgerRow(tx, undo.transactionId);
    const live = await tx.invoice.count({ where: { transactionId: undo.transactionId, status: "issued" } });
    if (live) throw new UndoRefused("invoiced");
  }

  // Put the plan back: drop what the payment added, park every seq out of the
  // way, then restore each instalment as it was.
  const keep = new Set(undo.before.map((r) => r.id));
  const added = undo.after.filter((r) => !keep.has(r.id)).map((r) => r.id);
  if (added.length) await tx.collectionPlanInstallment.deleteMany({ where: { id: { in: added } } });
  await tx.collectionPlanInstallment.updateMany({ where: { planId }, data: { seq: { increment: SEQ_PARK } } });
  for (const r of undo.before) {
    const isTarget = r.id === input.instalmentId;
    await tx.collectionPlanInstallment.update({
      where: { id: r.id },
      data: {
        seq: r.seq,
        expectedDate: toPrismaDate(r.expectedDate),
        amount: r.amount,
        description: r.description,
        // The paid one is due again; an executive's approved entry no longer holds it.
        status: isTarget ? "pending" : r.status,
        transactionId: isTarget ? null : r.transactionId,
        pendingApprovalId: isTarget ? null : r.pendingApprovalId,
        ...(isTarget ? { paymentUndo: Prisma.DbNull } : {}),
      },
    });
  }
  // An approved executive entry keeps its history but lets go of the instalment,
  // so it can be recorded again.
  await tx.pendingApproval.updateMany({
    where: { collectionInstallmentId: input.instalmentId, status: { not: "pending" } },
    data: { collectionInstallmentId: null },
  });
  if (!undo.linked) {
    await tx.transaction.update({ where: { id: undo.transactionId }, data: { deletedAt: new Date(), deletedById: input.userId } });
  }
  return { transactionId: undo.transactionId, linked: undo.linked, planId };
}

// ── the same payment twice ───────────────────────────────────────────────────

/** A UTR as compared: letters and digits only, upper case, leading zeros dropped; null when too short to mean anything. */
export function utrKey(s: string | null | undefined): string | null {
  const v = (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
  return v.length >= 4 ? v : null;
}

/**
 * Every reference-like token in the texts, compared as utrKey: each whole
 * text (a bank's reference field, spaces and all), its words, and the pieces
 * of hyphenated ones.
 */
export function refKeys(...texts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    const whole = utrKey(t);
    if (whole) out.add(whole);
    for (const word of (t ?? "").split(/[\s·,;|]+/)) {
      const k = utrKey(word);
      if (k) out.add(k);
      for (const piece of word.split(/[^A-Za-z0-9]+/)) {
        const p = utrKey(piece);
        if (p) out.add(p);
      }
    }
  }
  return out;
}

/** The UTR our own descriptions carry ("… · UTR ABC123 · …"). */
export function utrFromDescription(description: string | null | undefined): string | null {
  const m = (description ?? "").match(/\bUTR\s+([A-Za-z0-9][A-Za-z0-9\-/]*)/);
  return m ? m[1] : null;
}

export type DuplicatePayment = {
  source: "ledger" | "approval";
  id: string;
  date: string;
  amount: number;
  description: string | null;
  /** Already a recorded payment on some collection plan instalment. */
  linked: boolean;
};

/**
 * A live revenue entry for this party that already carries this UTR: in its
 * description (our "UTR x", the bank's "Ref x"), or on a bank statement line
 * matched to it. With `includeWaiting`, also an entry still waiting for
 * approval. Null when the UTR is empty or nothing matches.
 */
export async function findDuplicatePayment(
  db: Prisma.TransactionClient,
  input: { partyId: string; utr: string | null | undefined; includeWaiting?: boolean },
): Promise<DuplicatePayment | null> {
  const key = utrKey(input.utr);
  if (!key) return null;

  const ledger = await db.transaction.findMany({
    where: { partyId: input.partyId, type: "Revenue", deletedAt: null },
    select: {
      id: true,
      date: true,
      amount: true,
      description: true,
      collectionInstallment: { select: { id: true } },
      bankMatches: { select: { bankTransaction: { select: { referenceNumber: true, upiReference: true, bankReference: true, description: true } } } },
    },
    orderBy: { date: "desc" },
    take: 500,
  });
  for (const t of ledger) {
    const banks = t.bankMatches.flatMap((m) => [m.bankTransaction.referenceNumber, m.bankTransaction.upiReference, m.bankTransaction.bankReference, m.bankTransaction.description]);
    if (refKeys(t.description, ...banks).has(key)) {
      return {
        source: "ledger",
        id: t.id,
        date: fromPrismaDate(t.date),
        amount: Number(t.amount.toString()),
        description: t.description,
        linked: !!t.collectionInstallment,
      };
    }
  }

  if (input.includeWaiting) {
    const waiting = await db.pendingApproval.findMany({
      where: { status: "pending", kind: "create", proposed: { path: ["partyId"], equals: input.partyId } },
      select: { id: true, proposed: true },
      take: 200,
    });
    for (const p of waiting) {
      const d = (p.proposed ?? {}) as { date?: string; amount?: number; description?: string | null; type?: string };
      if (d.type === "Revenue" && refKeys(d.description).has(key)) {
        return { source: "approval", id: p.id, date: String(d.date ?? "").slice(0, 10), amount: Number(d.amount ?? 0), description: d.description ?? null, linked: false };
      }
    }
  }
  return null;
}
