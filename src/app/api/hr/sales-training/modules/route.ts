import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const CreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
});

/** Create a draft module at the end of the curriculum. */
export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  const last = await prisma.salesTrainingModule.aggregate({ _max: { sortOrder: true } });
  const mod = await prisma.salesTrainingModule.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description || null,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      createdById: userId,
    },
  });
  return NextResponse.json({ id: mod.id });
}

const ReorderSchema = z.object({ ids: z.array(z.string()).min(1).max(500) });

/** Persist a new curriculum order: ids in the order they should appear. */
export async function PUT(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = ReorderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await prisma.$transaction(
    parsed.data.ids.map((id, i) =>
      prisma.salesTrainingModule.update({ where: { id }, data: { sortOrder: i + 1 } }),
    ),
  );
  return NextResponse.json({ ok: true });
}
