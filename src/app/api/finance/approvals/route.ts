import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canApprove, canSeePage } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const PAGE = "/finance/approvals";

export async function GET() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canSeePage(perms, PAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Manager/admin sees all pending. Executives see their own (any status).
  const where = canApprove(perms) ? { status: "pending" } : { submittedById: userId };

  const items = await prisma.pendingApproval.findMany({
    where,
    include: {
      submittedBy: { select: { id: true, username: true, role: true } },
      reviewedBy: { select: { id: true, username: true, role: true } },
      targetTx: true,
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({
    items: items.map((p) => ({
      ...p,
      targetTx: p.targetTx
        ? { ...p.targetTx, amount: Number(p.targetTx.amount.toString()) }
        : null,
    })),
  });
}
