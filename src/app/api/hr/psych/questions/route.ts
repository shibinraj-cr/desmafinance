import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

const Create = z.object({
  testId: z.string().min(1),
  order: z.number().int().min(1),
  dimension: z.enum(["O", "C", "E", "A", "N", "VALIDITY"]),
  textEn: z.string().min(1),
  textMl: z.string().nullable().optional(),
  reverseScored: z.boolean().optional(),
  validityPairId: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export async function POST(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Create.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  const q = await prisma.psychQuestion.create({ data: parsed.data });
  return NextResponse.json({ question: q });
}
