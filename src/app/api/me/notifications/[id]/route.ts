import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";

const Schema = z.object({
  action: z.enum(["read", "acknowledge"]),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const emp = await employeeForUser(userId);
  if (!emp) return NextResponse.json({ error: "no employee profile" }, { status: 400 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const receipt = await prisma.hrNotificationReceipt.findUnique({
    where: { notificationId_employeeId: { notificationId: params.id, employeeId: emp.id } },
  });
  if (!receipt) return NextResponse.json({ error: "not found" }, { status: 404 });
  const now = new Date();
  const updated = await prisma.hrNotificationReceipt.update({
    where: { id: receipt.id },
    data:
      parsed.data.action === "read"
        ? { readAt: receipt.readAt ?? now }
        : { acknowledgedAt: now, readAt: receipt.readAt ?? now },
  });
  return NextResponse.json({ receipt: updated });
}
