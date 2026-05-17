import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

const UpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

const AssignSchema = z.object({
  serviceId: z.string().min(1),
  groupId: z.string().min(1).nullable(),
});

async function guard() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return { error: "unauthorized" as const, status: 401 };
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) return { error: "forbidden" as const, status: 403 };
  return { userId };
}

export async function GET() {
  const g = await guard();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const groups = await prisma.serviceGroup.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: {
      services: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          isActive: true,
          showInL2Targets: true,
        },
      },
    },
  });
  const ungrouped = await prisma.service.findMany({
    where: { groupId: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true, showInL2Targets: true },
  });
  return NextResponse.json({ groups, ungrouped });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const exists = await prisma.serviceGroup.findUnique({ where: { name: parsed.data.name } });
  if (exists) return NextResponse.json({ error: "name_taken" }, { status: 409 });
  const created = await prisma.serviceGroup.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description?.trim() || null,
      displayOrder: parsed.data.displayOrder ?? 0,
    },
  });
  return NextResponse.json({ group: created });
}

export async function PATCH(req: NextRequest) {
  const g = await guard();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const body = await req.json().catch(() => null);
  // Two modes: assigning a service to a group, or updating a group itself.
  if (body && "serviceId" in body) {
    const parsed = AssignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 400 });
    }
    if (parsed.data.groupId) {
      const gExists = await prisma.serviceGroup.findUnique({ where: { id: parsed.data.groupId } });
      if (!gExists) return NextResponse.json({ error: "group_not_found" }, { status: 404 });
    }
    await prisma.service.update({
      where: { id: parsed.data.serviceId },
      data: { groupId: parsed.data.groupId },
    });
    return NextResponse.json({ ok: true });
  }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const updated = await prisma.serviceGroup.update({
    where: { id: parsed.data.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description?.trim() || null }
        : {}),
      ...(parsed.data.displayOrder !== undefined
        ? { displayOrder: parsed.data.displayOrder }
        : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
  });
  return NextResponse.json({ group: updated });
}

export async function DELETE(req: NextRequest) {
  const g = await guard();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  // Free up services first; targets refuse deletes via Restrict FK.
  await prisma.service.updateMany({ where: { groupId: id }, data: { groupId: null } });
  const targetsLeft = await prisma.leadPulseTarget.count({ where: { groupId: id } });
  if (targetsLeft > 0) {
    return NextResponse.json(
      { error: "has_targets", count: targetsLeft },
      { status: 409 },
    );
  }
  await prisma.serviceGroup.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
