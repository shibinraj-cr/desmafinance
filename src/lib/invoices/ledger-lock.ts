import { Prisma, type PrismaClient } from "@prisma/client";
import { lockedFieldChanges } from "./core";

/**
 * An issued invoice freezes what it printed on the ledger row behind it.
 *
 * Every write path that edits or deletes a Transaction (src/lib/approval.ts)
 * locks the row and calls `invoiceBlocks` inside its database transaction.
 * Issuing an invoice locks the same row first, so an edit and an issue can
 * never interleave: whichever commits second sees the other.
 */

type Db = Prisma.TransactionClient | PrismaClient;

type LedgerRow = {
  id: string;
  type: string;
  date: Date;
  amount: Prisma.Decimal | number | string;
  paymentMode: string;
  partyId: string | null;
  expDom: string | null;
};

/**
 * Hold the ledger row until the surrounding database transaction ends. A lock
 * on one row by id, not a report read, so the isHistorical filter that
 * tests/finance-historical-guard.test.ts demands of ledger SQL doesn't apply.
 */
export async function lockLedgerRow(tx: Prisma.TransactionClient, txId: string): Promise<void> {
  // NO KEY UPDATE: conflicts with other edits and issues of this row, but not
  // with inserts that merely reference it (bank matches, instalments).
  await tx.$queryRaw`SELECT "id" FROM "Transaction" WHERE "id" = ${txId} FOR NO KEY UPDATE`;
}

/**
 * The live invoice that stops this edit (`proposed`) or delete (`null`), or
 * null when the change is allowed: no live invoice, or an edit that leaves
 * every printed field as it is.
 */
export async function invoiceBlocks(
  db: Db,
  current: LedgerRow,
  proposed: { type?: string; date?: string | Date; amount?: number | string; paymentMode?: string; partyId?: string | null; expDom?: string | null } | null,
): Promise<{ number: string; fields: string[] } | null> {
  const live = await db.invoice.findFirst({
    where: { transactionId: current.id, status: "issued" },
    select: { number: true },
  });
  if (!live) return null;
  if (proposed === null) return { number: live.number, fields: ["deleted"] };
  const normalisedProposed = {
    ...proposed,
    // approval.ts clears expDom on non-Revenue rows; compare what would be written.
    ...("expDom" in proposed || "type" in proposed
      ? { expDom: (proposed.type ?? current.type) === "Revenue" ? (proposed.expDom ?? null) : null }
      : {}),
  };
  const fields = lockedFieldChanges(current, normalisedProposed);
  return fields.length ? { number: live.number, fields } : null;
}

/** Thrown inside a database transaction to roll it back; caught by the caller. */
export class InvoicedRowError extends Error {
  constructor(readonly invoiceNumber: string) {
    super(`ledger row has live invoice ${invoiceNumber}`);
  }
}

/** Thrown inside a database transaction to roll it back: the row is a payment recorded on a collection plan. */
export class PlanLinkedRowError extends Error {
  constructor() {
    super("ledger row is a payment recorded on a collection plan");
  }
}

const dayOf = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * The collection plan payment this delete (`proposed` null) or edit would
 * break, or null. A payment recorded on a plan (Record payment, or linked
 * there) reshaped the plan by its amount: deleting it, or changing its
 * amount, date, party or type, is done from the plan with Undo payment.
 * Other fields (description, category, payment mode, EXP/DOM) stay editable.
 */
export async function planLinkBlocks(
  db: Db,
  current: LedgerRow,
  proposed: Parameters<typeof invoiceBlocks>[2],
): Promise<{ planId: string; seq: number } | null> {
  if (proposed !== null) {
    const changes =
      (proposed.type !== undefined && proposed.type !== current.type) ||
      (proposed.amount !== undefined && Number(proposed.amount) !== Number(current.amount.toString())) ||
      (proposed.date !== undefined && dayOf(proposed.date) !== dayOf(current.date)) ||
      (proposed.partyId !== undefined && (proposed.partyId ?? null) !== (current.partyId ?? null));
    if (!changes) return null;
  }
  // Recorded with Record payment (or linked) on a plan: it carries an undo snapshot.
  const inst = await db.collectionPlanInstallment.findFirst({
    where: { transactionId: current.id, status: "received", paymentUndo: { not: Prisma.AnyNull } },
    select: { planId: true, seq: true },
  });
  return inst ?? null;
}

/**
 * Inside a database transaction, before writing a ledger row: lock it, then
 * throw InvoicedRowError when a live invoice stops the edit (`proposed`) or
 * delete (`null`), and PlanLinkedRowError when it is a collection plan
 * payment the change would break. The caller catches them (guardedOrThrow).
 */
export async function guardLedgerWrite(
  tx: Prisma.TransactionClient,
  txId: string,
  proposed: Parameters<typeof invoiceBlocks>[2],
): Promise<void> {
  await lockLedgerRow(tx, txId);
  const fresh = await tx.transaction.findUnique({
    where: { id: txId },
    select: { id: true, type: true, date: true, amount: true, paymentMode: true, partyId: true, expDom: true },
  });
  if (!fresh) return; // gone: the write that follows reports it
  const blocked = await invoiceBlocks(tx, fresh, proposed);
  if (blocked) throw new InvoicedRowError(blocked.number);
  if (await planLinkBlocks(tx, fresh, proposed)) throw new PlanLinkedRowError();
}

export const INVOICED = Symbol("invoiced");

/** For `.catch()` on a guarded write: InvoicedRowError becomes INVOICED, anything else is rethrown. */
export function invoicedOrThrow(e: unknown): typeof INVOICED {
  if (e instanceof InvoicedRowError) return INVOICED;
  throw e;
}

export const PLAN_LINKED = Symbol("plan_linked");

/** For `.catch()` on a guarded write: INVOICED or PLAN_LINKED; anything else is rethrown. */
export function guardedOrThrow(e: unknown): typeof INVOICED | typeof PLAN_LINKED {
  if (e instanceof InvoicedRowError) return INVOICED;
  if (e instanceof PlanLinkedRowError) return PLAN_LINKED;
  throw e;
}
