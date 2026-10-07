import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { fromPrismaDate } from "@/lib/lead-pulse-dates";
import { requireBank } from "@/lib/bank/access";

export const dynamic = "force-dynamic";

/** GET /api/finance/bank-automation/runs/:id — live progress of one run. */
export const GET = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireBank("view");
  const run = await prisma.bankStatementRun.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      trigger: true,
      status: true,
      phase: true,
      fromDate: true,
      toDate: true,
      testResult: true,
      startedAt: true,
      completedAt: true,
      gmailMessagesFound: true,
      statementsProcessed: true,
      statementsFailed: true,
      transactionsCreated: true,
      transactionsSkipped: true,
      transactionsFailed: true,
      errorSummary: true,
      createdAt: true,
      events: { orderBy: { createdAt: "asc" }, take: 300, select: { id: true, level: true, step: true, message: true, createdAt: true } },
      statements: {
        orderBy: [{ periodStart: "asc" }, { createdAt: "asc" }],
        select: { id: true, periodStart: true, periodEnd: true, status: true, insertedCount: true, duplicateCount: true, transactionCount: true, lastError: true },
      },
    },
  });
  if (!run) throw notFound("Run not found");
  return NextResponse.json({
    ...run,
    fromDate: run.fromDate ? fromPrismaDate(run.fromDate) : null,
    toDate: run.toDate ? fromPrismaDate(run.toDate) : null,
    statements: run.statements.map((s) => ({
      ...s,
      periodStart: s.periodStart ? fromPrismaDate(s.periodStart) : null,
      periodEnd: s.periodEnd ? fromPrismaDate(s.periodEnd) : null,
    })),
  });
});
