import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = (session.user as { id?: string }).id ?? null;

  const existing = await prisma.transaction.findUnique({ where: { id: params.id } });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await prisma.transaction.update({
    where: { id: params.id },
    data: { deletedAt: new Date(), deletedById: userId },
  });

  await recordAudit({
    entityType: "Transaction",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: {
      date: existing.date.toISOString(),
      type: existing.type,
      category: existing.category,
      subItem: existing.subItem,
      description: existing.description,
      amount: Number(existing.amount.toString()),
    },
  });

  return NextResponse.json({ ok: true });
}
