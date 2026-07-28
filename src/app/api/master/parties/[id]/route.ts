import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const PartyServiceInput = z.object({
  serviceId: z.string().min(1),
  totalAmount: z.number().nonnegative().default(0),
  notes: z.string().max(500).optional().or(z.literal("")),
});

const PatchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  group: z.enum(["Candidate", "Vendor"]).optional(),
  txTypes: z.enum(["Revenue", "Expense", "Both"]).optional(),
  email: z.string().email().max(120).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  sourceId: z.string().optional().or(z.literal("")),
  assignedL2BdeId: z.string().nullable().optional().or(z.literal("")),
  partyServices: z.array(PartyServiceInput).optional(),
  serviceIds: z.array(z.string().min(1)).optional(),
});

/**
 * Permissions: any authenticated user can manage parties via this
 * endpoint (so the Finance-module mirror works for non-admins). The
 * /master-data/parties UI is still admin-only at the page layer.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });

  const party = await prisma.party.findUnique({
    where: { id: params.id },
    include: {
      partyServices: true,
      // Legacy M:M kept for backwards-compat reads.
      services: { select: { id: true } },
    },
  });
  if (!party) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const d = parsed.data;
  const update: Record<string, unknown> = {};
  if (d.name !== undefined) {
    const newName = d.name.trim();
    if (newName !== party.name) {
      // Names are unique per group; check against the group this party will end
      // up in (a rename may accompany a group change in the same request).
      const nameGroup = d.group ?? party.group;
      const collision = await prisma.party.findUnique({ where: { name_group: { name: newName, group: nameGroup } } });
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

  const effectiveGroup = d.group ?? party.group;

  // Source: required for Candidates, ignored for Vendors.
  if (effectiveGroup === "Candidate") {
    if (d.sourceId !== undefined) {
      if (!d.sourceId || d.sourceId.length === 0) {
        // Caller passed sourceId="" — treat as "must remain set"; reject.
        return NextResponse.json({ error: "source_required" }, { status: 400 });
      }
      const sourceExists = await prisma.leadPulseSource.findUnique({
        where: { id: d.sourceId },
        select: { id: true },
      });
      if (!sourceExists)
        return NextResponse.json({ error: "source_not_found" }, { status: 400 });
      update.sourceId = d.sourceId;
    } else if (!party.sourceId) {
      // Vendor → Candidate switch with no sourceId provided.
      return NextResponse.json({ error: "source_required" }, { status: 400 });
    }
  } else if (effectiveGroup === "Vendor") {
    update.sourceId = null;
  }

  // assignedL2BdeId — applies only to Candidates. Vendors clear the
  // field on save.
  if (effectiveGroup === "Candidate") {
    if (d.assignedL2BdeId !== undefined) {
      if (!d.assignedL2BdeId) {
        update.assignedL2BdeId = null;
      } else {
        // Soft-validate that the assigned user exists and is an active
        // L2. Don't hard-fail if not (e.g. role flipped after assignment)
        // — the matrix view will surface it.
        const targetRole = await prisma.leadPulseRole.findUnique({
          where: { userId: d.assignedL2BdeId },
        });
        if (!targetRole) {
          return NextResponse.json(
            { error: "assigned_l2_not_found" },
            { status: 400 },
          );
        }
        update.assignedL2BdeId = d.assignedL2BdeId;
      }
    }
  } else if (effectiveGroup === "Vendor") {
    update.assignedL2BdeId = null;
  }

  // Resolve services: prefer the new partyServices payload; fall back
  // to legacy serviceIds (totalAmount=0).
  let nextServices: Array<{ serviceId: string; totalAmount: number; notes?: string }> | null = null;
  if (effectiveGroup === "Vendor") {
    nextServices = [];
  } else {
    if (d.partyServices !== undefined) {
      const seen = new Set<string>();
      nextServices = [];
      for (const ps of d.partyServices) {
        if (seen.has(ps.serviceId)) continue;
        seen.add(ps.serviceId);
        nextServices.push({
          serviceId: ps.serviceId,
          totalAmount: ps.totalAmount,
          notes: ps.notes,
        });
      }
    } else if (d.serviceIds !== undefined) {
      const unique = Array.from(new Set(d.serviceIds));
      nextServices = unique.map((serviceId) => {
        const existingPs = party.partyServices.find((p) => p.serviceId === serviceId);
        return {
          serviceId,
          totalAmount: existingPs ? Number(existingPs.totalAmount.toString()) : 0,
        };
      });
    }
    if (nextServices !== null && nextServices.length === 0) {
      return NextResponse.json({ error: "service_required" }, { status: 400 });
    }
    if (
      nextServices === null &&
      party.partyServices.length === 0 &&
      party.services.length === 0
    ) {
      // Brand-new candidate (Vendor→Candidate switch) without any services.
      return NextResponse.json({ error: "service_required" }, { status: 400 });
    }
  }

  if (nextServices && nextServices.length > 0) {
    const found = await prisma.service.findMany({
      where: { id: { in: nextServices.map((p) => p.serviceId) } },
      select: { id: true },
    });
    if (found.length !== nextServices.length) {
      return NextResponse.json({ error: "service_not_found" }, { status: 400 });
    }
  }

  // Apply updates atomically: party scalar fields + replace partyServices set.
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.party.update({ where: { id: params.id }, data: update });
    if (nextServices !== null) {
      // Delete partyServices not in the new set; upsert the rest.
      const wantedIds = new Set(nextServices.map((s) => s.serviceId));
      const toDelete = party.partyServices.filter((p) => !wantedIds.has(p.serviceId));
      if (toDelete.length > 0) {
        await tx.partyService.deleteMany({
          where: { id: { in: toDelete.map((d) => d.id) } },
        });
      }
      for (const ns of nextServices) {
        await tx.partyService.upsert({
          where: { partyId_serviceId: { partyId: params.id, serviceId: ns.serviceId } },
          create: {
            partyId: params.id,
            serviceId: ns.serviceId,
            totalAmount: ns.totalAmount,
            notes: ns.notes && ns.notes.length > 0 ? ns.notes : null,
          },
          update: {
            totalAmount: ns.totalAmount,
            notes: ns.notes && ns.notes.length > 0 ? ns.notes : null,
          },
        });
      }
      // Also keep the legacy M:M in sync so older code paths that read
      // `Party.services` continue to work.
      await tx.party.update({
        where: { id: params.id },
        data: { services: { set: nextServices.map((ns) => ({ id: ns.serviceId })) } },
      });
    }
    return u;
  });

  await recordAudit({
    entityType: "Party",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: {
      before: {
        ...party,
        services: party.services.map((s) => s.id),
        partyServices: party.partyServices.map((p) => ({
          serviceId: p.serviceId,
          totalAmount: Number(p.totalAmount.toString()),
        })),
      },
      after: { ...d, partyServices: nextServices ?? undefined },
    },
  });
  return NextResponse.json({ party: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
