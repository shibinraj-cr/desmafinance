import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const PatchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  group: z.enum(["Candidate", "Vendor"]).optional(),
  txTypes: z.enum(["Revenue", "Expense", "Both"]).optional(),
  email: z.string().email().max(120).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });

  const party = await prisma.party.findUnique({ where: { id: params.id } });
  if (!party) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const d = parsed.data;
  const update: Record<string, unknown> = {};
  if (d.name !== undefined) {
    const newName = d.name.trim();
    if (newName !== party.name) {
      const collision = await prisma.party.findUnique({ where: { name: newName } });
      if (collision && collision.id !== party.id) {
        return NextResponse.json({ error: "name_taken" }, { status: 409 });
      }
      update.name = newName;
    }
  }
  if (d.group !== undefined) update.group = d.group;
  if (d.txTypes !== undefined) update.txTypes = d.txTypes;
  if (d.email !== undefined)
    update.email = d.email && d.email.length > 0 ? d.email.trim().toLowerCase() : null;
  if (d.phone !== undefined)
    update.phone = d.phone && d.phone.length > 0 ? d.phone.trim() : null;
  if (d.notes !== undefined)
    update.notes = d.notes && d.notes.length > 0 ? d.notes.trim() : null;
  if (d.isActive !== undefined) update.isActive = d.isActive;

  const updated = await prisma.party.update({ where: { id: params.id }, data: update });
  await recordAudit({
    entityType: "Party",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { before: party, after: d },
  });
  return NextResponse.json({ party: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageUsers(perms))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const party = await prisma.party.findUnique({
    where: { id: params.id },
    include: { _count: { select: { transactions: true } } },
  });
  if (!party) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (party._count.transactions > 0) {
    return NextResponse.json(
      { error: "in_use", message: "Set isActive=false to retire instead." },
      { status: 409 },
    );
  }

  await prisma.party.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "Party",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { name: party.name, group: party.group },
  });
  return NextResponse.json({ ok: true });
}
