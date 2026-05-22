import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const PatchSchema = z.object({
  title: z.string().optional(),
  body: z.string().optional(),
  version: z.string().optional(),
  category: z.string().nullable().optional(),
  externalUrl: z.string().nullable().optional(),
  requiresAck: z.boolean().optional(),
  publish: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const existing = await prisma.hrPolicy.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (d.title !== undefined) data.title = d.title;
  if (d.body !== undefined) data.body = d.body;
  if (d.version !== undefined) data.version = d.version;
  if (d.category !== undefined) data.category = d.category;
  if (d.externalUrl !== undefined) data.externalUrl = d.externalUrl || null;
  if (d.requiresAck !== undefined) data.requiresAck = d.requiresAck;
  if (d.publish === true && existing.status === "draft") {
    data.status = "published";
    data.publishedAt = new Date();
    data.publishedById = userId;
  }

  const policy = await prisma.hrPolicy.update({ where: { id: params.id }, data });

  if (d.publish === true && existing.status === "draft") {
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
    await prisma.hrAuditLog.create({
      data: {
        actorUserId: userId,
        eventType: "policy_published",
        entityType: "HrPolicy",
        entityId: policy.id,
        metadata: { title: policy.title, version: policy.version },
      },
    });
  }

  return NextResponse.json({ policy });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await prisma.hrPolicy.delete({ where: { id: params.id } });
  return NextResponse.json({ deleted: true });
}
