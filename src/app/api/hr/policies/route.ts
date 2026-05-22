import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const Schema = z.object({
  title: z.string().min(1),
  version: z.string().min(1).default("v1"),
  body: z.string().min(1),
  externalUrl: z.string().url().nullable().optional().or(z.literal("")),
  category: z.string().nullable().optional(),
  requiresAck: z.boolean().default(true),
  publish: z.boolean().default(false),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const policies = await prisma.hrPolicy.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { acks: true } } },
  });
  return NextResponse.json({ policies });
}

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const policy = await prisma.hrPolicy.create({
    data: {
      title: d.title,
      version: d.version,
      body: d.body,
      externalUrl: d.externalUrl || null,
      category: d.category ?? null,
      requiresAck: d.requiresAck,
      status: d.publish ? "published" : "draft",
      publishedAt: d.publish ? new Date() : null,
      publishedById: d.publish ? userId : null,
    },
  });
  if (d.publish) {
    await broadcastPolicy(policy.id);
    await prisma.hrAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: "policy_published",
        entityType: "HrPolicy",
        entityId: policy.id,
        metadata: { title: d.title, version: d.version },
      },
    });
  }
  return NextResponse.json({ policy });
}

async function broadcastPolicy(policyId: string) {
  const policy = await prisma.hrPolicy.findUnique({ where: { id: policyId } });
  if (!policy) return;
  const employees = await prisma.employee.findMany({ where: { active: true, userId: { not: null } } });
  const notif = await prisma.hrNotification.create({
    data: {
      title: `New policy: ${policy.title}`,
      body: policy.body.slice(0, 240),
      linkUrl: `/me/policies/${policy.id}`,
      kind: "policy",
      requiresAck: policy.requiresAck,
    },
  });
  for (const e of employees) {
    await prisma.hrNotificationReceipt.upsert({
      where: { notificationId_employeeId: { notificationId: notif.id, employeeId: e.id } },
      update: {},
      create: { notificationId: notif.id, employeeId: e.id },
    });
  }
}
