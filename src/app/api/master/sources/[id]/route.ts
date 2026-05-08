import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const PatchSchema = z.object({
  label: z.string().min(2).max(80).optional(),
  displayOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });

  const existing = await prisma.leadPulseSource.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const update: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) update.label = parsed.data.label.trim();
  if (parsed.data.displayOrder !== undefined) update.displayOrder = parsed.data.displayOrder;
  if (parsed.data.active !== undefined) update.active = parsed.data.active;

  const updated = await prisma.leadPulseSource.update({ where: { id: params.id }, data: update });
  await recordAudit({
    entityType: "LeadPulseSource",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { before: existing, after: parsed.data },
  });
  return NextResponse.json({ source: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const existing = await prisma.leadPulseSource.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Block hard-delete when the source is referenced. Operators should
  // deactivate (active=false) instead — preserves history.
  const partyCount = await prisma.party.count({ where: { sourceId: params.id } });
  const entryCount = await prisma.leadPulseDailyEntry.count({
    where: { sourceId: params.id },
  });
  if (partyCount > 0 || entryCount > 0) {
    return NextResponse.json(
      {
        error: "in_use",
        message: `Source is referenced by ${partyCount} parties and ${entryCount} entries. Deactivate instead.`,
      },
      { status: 409 },
    );
  }

  await prisma.leadPulseSource.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "LeadPulseSource",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { code: existing.code, label: existing.label },
  });
  return NextResponse.json({ ok: true });
}
