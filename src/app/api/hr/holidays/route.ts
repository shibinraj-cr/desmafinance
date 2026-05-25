import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const Schema = z.object({
  date: z.string().min(8),
  label: z.string().min(1),
  paid: z.boolean().default(true),
  notes: z.string().nullable().optional(),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const holidays = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  return NextResponse.json({ holidays });
}

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const date = new Date(parsed.data.date);
  const holiday = await prisma.holiday.upsert({
    where: { date },
    update: {
      label: parsed.data.label,
      paid: parsed.data.paid,
      notes: parsed.data.notes ?? null,
      updatedById: userId,
    },
    create: {
      date,
      label: parsed.data.label,
      paid: parsed.data.paid,
      notes: parsed.data.notes ?? null,
      createdById: userId,
      updatedById: userId,
    },
  });
  return NextResponse.json({ holiday });
}
