import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const PAGE = "/finance/approvals";

/**
 * GET /api/finance/drafts — list the current user's TransactionDraft rows.
 * Only the owner sees their drafts (no cross-user visibility).
 */
export async function GET() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePage(perms, PAGE)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!perms.draftFirst && !perms.isAdmin) {
    // Anyone who isn't on the draft workflow and isn't an admin has
    // no business listing drafts.
    return NextResponse.json({ drafts: [] });
  }
  // Admins see every user's drafts (oversight); draftFirst users see
  // only their own.
  const where = perms.isAdmin ? {} : { submittedById: userId };
  const drafts = await prisma.transactionDraft.findMany({
    where,
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
