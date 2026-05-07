import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canApprove } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const role = session.user.role ?? "executive";
  const userId = session.user.id;

  // Manager/admin sees all pending. Executives see their own (any status).
  const where = canApprove(role)
    ? { status: "pending" }
    : { submittedById: userId };

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
