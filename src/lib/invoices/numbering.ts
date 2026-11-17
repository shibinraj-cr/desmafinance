import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Invoice numbers shared across modules. D/DLLC is one series used by both
 * candidate invoices (Wio payments) and Partner Commission invoices, so both
 * take the same lock on a stem ("D/DLLC/26-27/") while they pick or check a
 * number, and each refuses a number the other already holds.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export async function advisoryLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Serialise everyone numbering inside one stem, until the transaction ends. */
export async function lockInvoiceStem(tx: Prisma.TransactionClient, stem: string): Promise<void> {
  await advisoryLock(tx, `invoice-stem:${stem.toUpperCase()}`);
}

/** "D/DLLC/26-27/025" → "D/DLLC/26-27/". */
export function stemOfNumber(number: string): string {
  const i = number.lastIndexOf("/");
  return i >= 0 ? number.slice(0, i + 1) : number;
}

/** The running number at the end of a number ("…/031" → 31), or null. */
function runningNumber(number: string): number | null {
  const tail = number.slice(stemOfNumber(number).length);
  return /^\d+$/.test(tail) ? Number(tail) : null;
}

/**
 * Whether a candidate invoice already holds this number. Compared the way a
 * person reads it: same stem ignoring case, same running number ignoring
 * leading zeros, so "D/DLLC/26-27/31" is taken when "D/DLLC/26-27/031" is.
 */
export async function candidateInvoiceNumberTaken(db: Db, number: string): Promise<boolean> {
  const stem = stemOfNumber(number);
  const seq = runningNumber(number);
  const rows = await db.invoice.findMany({ where: { number: { startsWith: stem, mode: "insensitive" } }, select: { number: true } });
  return rows.some((r) => r.number.toUpperCase() === number.toUpperCase() || (seq != null && runningNumber(r.number) === seq));
}

/**
 * What candidate invoices hold in a stem, for Partner Commissions' suggestion:
 * the numbers used, and the candidate series' "next number" floor when it is
 * written for this stem.
 */
export async function candidateStemState(db: Db, stem: string): Promise<{ numbers: string[]; floor: string | null }> {
  const [rows, series] = await Promise.all([
    db.invoice.findMany({ where: { number: { startsWith: stem, mode: "insensitive" } }, select: { number: true } }),
    db.invoiceSeries.findMany({ where: { nextNumber: { startsWith: stem, mode: "insensitive" } }, select: { nextNumber: true } }),
  ]);
  return {
    numbers: rows.map((r) => r.number.toUpperCase()),
    floor: series.map((s) => s.nextNumber!.toUpperCase()).sort((a, b) => (runningNumber(b) ?? 0) - (runningNumber(a) ?? 0))[0] ?? null,
  };
}

/** The higher of two numbers in one stem, by running number. */
export function laterNumber(a: string, b: string): string {
  return (runningNumber(b) ?? -1) > (runningNumber(a) ?? -1) ? b : a;
}
