import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage, canWorkSalaryDrafts } from "@/lib/rbac";
import { draftScope } from "@/lib/approval";

export const dynamic = "force-dynamic";

const PAGE = "/finance/approvals";

/**
 * GET /api/finance/drafts — list the TransactionDraft rows the current user
 * works: their own, plus salary drafts for Finance (see draftScope).
 */
export async function GET() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePage(perms, PAGE)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!perms.draftFirst && !canWorkSalaryDrafts(perms)) {
    // Anyone who isn't on the draft workflow and doesn't work salary
    // drafts has no business listing drafts.
    return NextResponse.json({ drafts: [] });
  }
  const drafts = await prisma.transactionDraft.findMany({
    where: draftScope(perms, userId),
    orderBy: [{ createdAt: "desc" }],
    include: {
      party: { select: { id: true, name: true, group: true } },
      submittedBy: { select: { id: true, username: true } },
    },
  });
  return NextResponse.json({
    drafts: drafts.map((d) => ({
      id: d.id,
      date: d.date.toISOString().slice(0, 10),
      month: d.month,
      type: d.type,
      category: d.category,
      subItem: d.subItem,
      description: d.description,
      paymentMode: d.paymentMode,
      amount: Number(d.amount.toString()),
      flow: d.flow,
      partyId: d.partyId,
      partyName: d.party?.name ?? null,
      partyGroup: d.party?.group ?? null,
      submittedById: d.submittedById,
      submittedByUsername: d.submittedBy?.username ?? null,
      createdAt: d.createdAt.toISOString(),
    })),
  });
}
