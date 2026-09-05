import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const Schema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).nullish(),
  icon: z.string().trim().max(40).optional(),
  color: z.string().trim().max(20).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

/** PATCH /api/news/topics/[id] — edit a topic. Admin only. The slug never changes. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  const exists = await prisma.newsTopic.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.newsTopic.update({
    where: { id: params.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined ? { description: d.description || null } : {}),
      ...(d.icon !== undefined ? { icon: d.icon } : {}),
      ...(d.color !== undefined ? { color: d.color } : {}),
      ...(d.sortOrder !== undefined ? { sortOrder: d.sortOrder } : {}),
      ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/news/topics/[id] — remove a topic, its sources and its items.
 * Admin only, and refused while the topic still holds updates: deactivating is
 * the reversible way to retire a topic, and deleting one with history behind it
 * is almost always a mis-click.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const topic = await prisma.newsTopic.findUnique({
    where: { id: params.id },
    select: { id: true, _count: { select: { items: true } } },
  });
  if (!topic) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (topic._count.items > 0) {
    return NextResponse.json(
      {
        error: `This topic has ${topic._count.items} update(s). Turn it off instead of deleting, or delete its updates first.`,
      },
      { status: 409 },
    );
  }

  await prisma.newsTopic.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
