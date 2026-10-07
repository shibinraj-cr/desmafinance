import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireBank } from "@/lib/bank/access";
import { STATEMENT_SELECT, serializeStatement } from "@/lib/bank/queries";

export const dynamic = "force-dynamic";

const STATUSES = new Set([
  "NEW", "EMAIL_FOUND", "DOWNLOADING", "PDF_DOWNLOADED", "PARSING", "PROCESSED",
  "NO_TRANSACTIONS", "REVIEW_REQUIRED", "FAILED", "MANUAL_ACTION_REQUIRED", "DUPLICATE",
]);

/** GET /api/finance/bank-statements?account=&status=&page= — statement register. */
export const GET = withApiHandler(async (req: Request) => {
  await requireBank("view");
  const sp = new URL(req.url).searchParams;
  const statuses = sp.getAll("status").filter((s) => STATUSES.has(s));
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const where = {
    ...(sp.get("account") ? { integrationId: sp.get("account")! } : {}),
    ...(statuses.length ? { status: { in: statuses } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.bankStatement.findMany({
      where,
      select: STATEMENT_SELECT,
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * 50,
      take: 50,
    }),
    prisma.bankStatement.count({ where }),
  ]);
  return NextResponse.json({ statements: rows.map(serializeStatement), total, page });
});
