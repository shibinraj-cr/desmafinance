import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireBank } from "@/lib/bank/access";
import { STATEMENT_SELECT, serializeStatement } from "@/lib/bank/queries";

export const dynamic = "force-dynamic";

/** GET /api/finance/bank-statements/:id — one statement and its event timeline. */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireBank("view");
  const s = await prisma.bankStatement.findUnique({ where: { id: params.id }, select: { ...STATEMENT_SELECT, reviewPayload: true } });
  if (!s) throw notFound("Statement not found");
  const events = await prisma.bankAutomationEvent.findMany({
    where: { statementId: s.id },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: { id: true, level: true, step: true, message: true, createdAt: true },
  });
  const held = Array.isArray(s.reviewPayload) ? (s.reviewPayload as Array<Record<string, unknown>>) : [];
  return NextResponse.json({
    statement: serializeStatement(s),
    events,
    // Held rows (REVIEW_REQUIRED only), in rupees, for the reviewer.
    held: held.map((r) => ({
      date: r.txnDate,
      description: r.description,
      reference: r.referenceNumber,
      debit: Number(r.debit) / 100,
      credit: Number(r.credit) / 100,
      balance: r.balance === null ? null : Number(r.balance) / 100,
    })),
  });
});
