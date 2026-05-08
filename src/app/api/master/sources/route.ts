import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

/**
 * Sources master — wraps `LeadPulseSource` so it can be managed from
 * `/master-data/sources` (and read from the Candidate creation flow)
 * without anyone needing supervisor rights on Lead Pulse. Any
 * authenticated user can list / create / edit. The Lead Pulse settings
 * page still works against the same table.
 */
const CreateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_]+$/, "lowercase letters, digits, underscore"),
  label: z.string().min(2).max(80),
  displayOrder: z.number().int().min(0).default(100),
  active: z.boolean().default(true),
});

export const dynamic = "force-dynamic";

export async function GET() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sources = await prisma.leadPulseSource.findMany({
    orderBy: [{ displayOrder: "asc" }, { label: "asc" }],
  });
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
  await recordAudit({
    entityType: "LeadPulseSource",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { code, label: d.label },
  });
  return NextResponse.json({ source: created });
}
