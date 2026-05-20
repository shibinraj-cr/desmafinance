import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/finance/drafts — list the current user's TransactionDraft rows.
 * Only the owner sees their drafts (no cross-user visibility).
 */
export async function GET() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!perms.draftFirst) {
    // Non-draftFirst users shouldn't see drafts at all — return empty.
    return NextResponse.json({ drafts: [] });
  }
  const drafts = await prisma.transactionDraft.findMany({
    where: { submittedById: userId },
    orderBy: [{ createdAt: "desc" }],
    include: { party: { select: { id: true, name: true, group: true } } },
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
      createdAt: d.createdAt.toISOString(),
    })),
  });
}
