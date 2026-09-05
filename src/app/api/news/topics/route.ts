import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { slugify } from "@/lib/news/read";

const Schema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  icon: z.string().trim().max(40).optional(),
  color: z.string().trim().max(20).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

/** POST /api/news/topics — create a topic. Admin only. */
export async function POST(req: Request) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;

  // The slug is derived, so two topics named similarly enough can collide. Suffix
  // rather than reject: the admin named the topic, not the key.
  const base = slugify(d.name);
  let slug = base;
  for (let n = 2; n < 50; n++) {
    const clash = await prisma.newsTopic.findUnique({ where: { slug }, select: { id: true } });
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  const topic = await prisma.newsTopic.create({
    data: {
      slug,
      name: d.name,
      description: d.description || null,
      icon: d.icon || "newspaper",
      color: d.color || "blue",
      sortOrder: d.sortOrder ?? 0,
      createdById: userId,
    },
  });
  return NextResponse.json({ ok: true, topic: { id: topic.id, slug: topic.slug } });
}
