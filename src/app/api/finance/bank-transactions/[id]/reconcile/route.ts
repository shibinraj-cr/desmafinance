import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { requireBank } from "@/lib/bank/access";
import { logEvent } from "@/lib/bank/events";
import { reconStatusFor } from "@/lib/bank/queries";

export const dynamic = "force-dynamic";

const Schema = z.object({
  // The complete set of ledger matches for this bank line (replaces any existing).
  matches: z
    .array(z.object({ transactionId: z.string().min(1), amount: z.number().positive().max(1e12) }))
    .max(50)
    .optional(),
  // Set by hand: IGNORED / MANUAL_REVIEW / UNMATCHED. Omitted → derived from the matches.
  status: z.enum(["UNMATCHED", "IGNORED", "MANUAL_REVIEW"]).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * POST /api/finance/bank-transactions/:id/reconcile — associate a bank line
 * with existing ledger Transactions (one, or several for a split), or mark it
 * IGNORED / MANUAL_REVIEW. MATCHED vs PARTIALLY_MATCHED follows from the
 * matched total. Manual only in v1: nothing is ever matched automatically.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId } = await requireBank("reconcile");
  const body = Schema.parse(await req.json());
  const bt = await prisma.bankTransaction.findUnique({
    where: { id: params.id },
    select: { id: true, integrationId: true, direction: true, debitAmount: true, creditAmount: true },
  });
  if (!bt) throw notFound("Bank transaction not found");
  const amount = Number((bt.direction === "DEBIT" ? bt.debitAmount : bt.creditAmount).toString());

  let status: string;
  if (body.matches !== undefined) {
    const ids = Array.from(new Set(body.matches.map((m) => m.transactionId)));
    if (ids.length !== body.matches.length) throw badRequest("A ledger transaction can be matched once");
    const found = await prisma.transaction.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw badRequest("One of the ledger transactions no longer exists");
    const total = body.matches.reduce((s, m) => s + m.amount, 0);
    if (Math.round(total * 100) > Math.round(amount * 100)) throw badRequest("Matched amounts exceed the bank amount");
    status = body.status ?? reconStatusFor(amount, total);
    await prisma.$transaction([
      prisma.bankTransactionMatch.deleteMany({ where: { bankTransactionId: bt.id } }),
      prisma.bankTransactionMatch.createMany({
        data: body.matches.map((m) => ({
          bankTransactionId: bt.id,
          transactionId: m.transactionId,
          amount: m.amount.toFixed(2),
          note: body.note ?? null,
          createdById: userId,
        })),
      }),
      prisma.bankTransaction.update({
        where: { id: bt.id },
        data: { reconciliationStatus: status, reconciliationNote: body.note ?? null, reconciledById: userId, reconciledAt: new Date() },
      }),
    ]);
  } else if (body.status) {
    status = body.status;
    await prisma.bankTransaction.update({
      where: { id: bt.id },
      data: { reconciliationStatus: status, reconciliationNote: body.note ?? null, reconciledById: userId, reconciledAt: new Date() },
    });
  } else {
    throw badRequest("Provide matches or a status");
  }

  await recordAudit({ entityType: "BankTransaction", entityId: bt.id, action: "UPDATE", userId, changes: { reconciliation: status, matches: body.matches, note: body.note } });
  await logEvent({ integrationId: bt.integrationId, step: "reconcile", message: `Transaction ${bt.id} marked ${status}`, userId });
  return NextResponse.json({ ok: true, status });
});
