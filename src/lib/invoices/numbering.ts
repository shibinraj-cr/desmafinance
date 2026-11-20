import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { intoStem, runningNumber, sameInvoiceNumber, stemKey, stemOfNumber, stemVariants } from "./core";

/**
 * Invoice numbers shared across modules. D/DLLC is one series used by both
 * candidate invoices (Wio payments) and Partner Commission invoices, so both
 * take the same lock on a stem while they pick or check a number, and each
 * refuses a number the other already holds. The year may be written "26-27"
 * or "2627" — it is still one series.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export async function advisoryLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Serialise everyone numbering inside one series (any year style), until the transaction ends. */
export async function lockInvoiceStem(tx: Prisma.TransactionClient, stem: string): Promise<void> {
  await advisoryLock(tx, `invoice-stem:${stemKey(stem)}`);
}

export { stemOfNumber };

/**
 * Whether a candidate invoice already holds this number. Compared the way a
 * person reads it: same series whatever the year style ("D/DLLC/26-27/" =
 * "D/DLLC/2627/"), same running number ignoring leading zeros, so
 * "D/DLLC/2627/31" is taken when "D/DLLC/26-27/031" is.
 */
export async function candidateInvoiceNumberTaken(db: Db, number: string): Promise<boolean> {
  const rows = await db.invoice.findMany({ where: { OR: stemVariants(stemOfNumber(number)).map((s) => ({ number: { startsWith: s, mode: "insensitive" as const } })) }, select: { number: true } });
  return rows.some((r) => sameInvoiceNumber(r.number, number));
}

/**
 * What candidate invoices hold in a stem, for Partner Commissions' suggestion:
 * the numbers used, and the candidate series' "next number" floor when it is
 * written for this stem.
 */
export async function candidateStemState(db: Db, stem: string): Promise<{ numbers: string[]; floor: string | null }> {
  const variants = stemVariants(stem);
  const [rows, series] = await Promise.all([
    db.invoice.findMany({ where: { OR: variants.map((s) => ({ number: { startsWith: s, mode: "insensitive" as const } })) }, select: { number: true } }),
    db.invoiceSeries.findMany({ where: { OR: variants.map((s) => ({ nextNumber: { startsWith: s, mode: "insensitive" as const } })) }, select: { nextNumber: true } }),
  ]);
  return {
    numbers: intoStem(stem, rows.map((r) => r.number)),
    floor: intoStem(stem, series.map((s) => s.nextNumber)).sort((a, b) => (runningNumber(b) ?? 0) - (runningNumber(a) ?? 0))[0] ?? null,
  };
}

/** The higher of two numbers in one stem, by running number. */
export function laterNumber(a: string, b: string): string {
  return (runningNumber(b) ?? -1) > (runningNumber(a) ?? -1) ? b : a;
}
