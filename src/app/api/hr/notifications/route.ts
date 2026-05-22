import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const Schema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  linkUrl: z.string().nullable().optional(),
  requiresAck: z.boolean().default(false),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const notifs = await prisma.hrNotification.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { receipts: true } } },
  });
  return NextResponse.json({ notifs });
}

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const employees = await prisma.employee.findMany({ where: { active: true, userId: { not: null } } });
  const notif = await prisma.hrNotification.create({
    data: {
      title: parsed.data.title,
      body: parsed.data.body,
      linkUrl: parsed.data.linkUrl ?? null,
      kind: "announcement",
      requiresAck: parsed.data.requiresAck,
      createdById: userId,
    },
  });
  for (const e of employees) {
    await prisma.hrNotificationReceipt.create({
      data: { notificationId: notif.id, employeeId: e.id },
    });
  }
  return NextResponse.json({ notif, recipients: employees.length });
}
