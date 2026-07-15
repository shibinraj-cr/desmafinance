import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const Schema = z.object({ action: z.enum(["read"]) });

// POST /api/crm/notifications/[id] — mark one of the current user's CRM
// notifications as read. Scoped by userId so a user can only touch their own.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const res = await prisma.crmNotification.updateMany({
    where: { id: params.id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (res.count === 0) {
    // Zero rows means not-found / not-theirs, or already read. Only 404 the
    // first case; an already-read notification is a harmless no-op.
    const exists = await prisma.crmNotification.findFirst({
      where: { id: params.id, userId },
      select: { id: true },
    });
    if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
