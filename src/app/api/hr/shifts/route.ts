import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr, isHrUser } from "@/lib/hr-rbac";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const ShiftSchema = z.object({
  code: z.string().min(1).max(8),
  name: z.string().min(1),
  startTime: z.string().regex(TIME_RE, "Use HH:mm"),
  endTime: z.string().regex(TIME_RE, "Use HH:mm"),
  graceMinutes: z.number().int().min(0).max(120).default(0),
  halfDayCutoffTime: z.string().regex(TIME_RE).nullable().optional(),
  active: z.boolean().default(true),
});

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!isHrUser(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const shifts = await prisma.hrShift.findMany({ orderBy: { code: "asc" } });
  return NextResponse.json({ shifts });
}

export async function POST(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json();
  const parsed = ShiftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const shift = await prisma.hrShift.create({ data: parsed.data });
  return NextResponse.json({ shift });
}
