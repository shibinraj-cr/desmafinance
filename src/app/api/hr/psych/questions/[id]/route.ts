import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const Patch = z.object({
  textEn: z.string().min(1).optional(),
  textMl: z.string().nullable().optional(),
  reverseScored: z.boolean().optional(),
  active: z.boolean().optional(),
  order: z.number().int().min(1).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  const q = await prisma.psychQuestion.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ question: q });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const q = await prisma.psychQuestion.update({
    where: { id: params.id },
    data: { active: false },
  });
  return NextResponse.json({ question: q });
}
