import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits, _"),
  label: z.string().min(2).max(80),
  displayOrder: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export async function GET() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sources = await prisma.leadPulseSource.findMany({
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
  });
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const { userId: actorId, perms } = await getCurrentUserAndPermissions();
  if (!actorId || !perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const access = await getLeadPulseAccess(actorId, perms);
  if (!access.canSupervise)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const d = parsed.data;
  const code = d.code.toLowerCase().trim();

  const existing = await prisma.leadPulseSource.findUnique({ where: { code } });
  if (existing) return NextResponse.json({ error: "code_taken" }, { status: 409 });

  const created = await prisma.leadPulseSource.create({
    data: {
      code,
      label: d.label.trim(),
      displayOrder: d.displayOrder,
      active: d.active,
    },
  });
  await prisma.leadPulseAuditLog.create({
    data: {
      actorUserId: actorId,
      eventType: "source_added",
      targetId: created.id,
      metadata: { code, label: d.label },
    },
  });
  return NextResponse.json({ source: created });
}
