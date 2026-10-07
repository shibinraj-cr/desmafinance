import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireBank } from "@/lib/bank/access";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/bank-transactions/:id/candidates?q= — ledger Transactions a
 * bank line could be matched to: same direction (credit ↔ Revenue, debit ↔
 * Expense), dated within ±7 days. Exact-amount matches rank first. With `q`,
 * searches description / party / category across a wider ±60 days.
 * Suggestions only — nothing is matched until a person picks one.
 */
export const GET = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  await requireBank("reconcile");
  const bt = await prisma.bankTransaction.findUnique({
    where: { id: params.id },
    select: {
      txnDate: true,
      direction: true,
      debitAmount: true,
      creditAmount: true,
      matches: { select: { transactionId: true, amount: true, note: true, transaction: { select: { date: true, description: true, category: true, amount: true } } } },
    },
  });
  if (!bt) throw notFound("Bank transaction not found");
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 80);
  const amount = Number((bt.direction === "DEBIT" ? bt.debitAmount : bt.creditAmount).toString());
  const days = q ? 60 : 7;
  const lo = new Date(bt.txnDate.getTime() - days * 86_400_000);
  const hi = new Date(bt.txnDate.getTime() + (days + 1) * 86_400_000);

  const rows = await prisma.transaction.findMany({
    where: {
      deletedAt: null,
      type: bt.direction === "CREDIT" ? "Revenue" : "Expense",
      date: { gte: lo, lt: hi },
      ...(q
        ? {
            OR: [
              { description: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
              { subItem: { contains: q, mode: "insensitive" } },
              { party: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      date: true,
      type: true,
      category: true,
      subItem: true,
      description: true,
      paymentMode: true,
      amount: true,
      party: { select: { name: true } },
      employee: { select: { name: true } },
      _count: { select: { bankMatches: true } },
    },
    take: 200,
  });
  const candidates = rows
    .map((t) => ({
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      type: t.type,
      category: `${t.category} · ${t.subItem}`,
      description: t.description,
      paymentMode: t.paymentMode,
      amount: Number(t.amount.toString()),
      counterparty: t.party?.name ?? t.employee?.name ?? null,
      alreadyMatched: t._count.bankMatches > 0,
      exact: Math.abs(Number(t.amount.toString()) - amount) < 0.005,
      dayGap: Math.abs(Math.round((t.date.getTime() - bt.txnDate.getTime()) / 86_400_000)),
    }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.dayGap - b.dayGap || Math.abs(a.amount - amount) - Math.abs(b.amount - amount))
    .slice(0, 30);

  return NextResponse.json({
    amount,
    candidates,
    matches: bt.matches.map((m) => ({
      transactionId: m.transactionId,
      amount: Number(m.amount.toString()),
      note: m.note,
      date: m.transaction.date.toISOString().slice(0, 10),
      description: m.transaction.description,
      category: m.transaction.category,
    })),
  });
});
