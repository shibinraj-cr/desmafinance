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

const CreateSchema = z.object({
  name: z.string().min(2).max(160),
  group: z.enum(["Candidate", "Vendor"]),
  txTypes: z.enum(["Revenue", "Expense", "Both"]).default("Both"),
  email: z.string().email().max(120).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
  sourceId: z.string().min(1).optional().or(z.literal("")),
  // New per-service-with-amount payload
  partyServices: z.array(PartyServiceInput).optional(),
  // Legacy bare-id list — accepted for back-compat. Each entry becomes a
  // PartyService with totalAmount=0.
  serviceIds: z.array(z.string().min(1)).optional(),
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const txType = searchParams.get("txType");
  const group = searchParams.get("group");
  const onlyActive = searchParams.get("active") !== "false";

  const where = {
    ...(onlyActive ? { isActive: true } : {}),
    ...(group ? { group } : {}),
    ...(txType
      ? { OR: [{ txTypes: txType }, { txTypes: "Both" }] }
      : {}),
  };

  const parties = await prisma.party.findMany({
    where,
    orderBy: [{ group: "asc" }, { name: "asc" }],
    include: { _count: { select: { transactions: true } } },
  });
  return NextResponse.json({ parties });
}

export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const d = parsed.data;
  const name = d.name.trim();

  // Names are unique per group (a Candidate and a Vendor may share a name), so
  // scope the duplicate check to the group being created.
  const existing = await prisma.party.findUnique({ where: { name_group: { name, group: d.group } } });
  if (existing) return NextResponse.json({ error: "name_taken" }, { status: 409 });

  // Normalise services payload — prefer the new shape; fall back to
  // legacy serviceIds with totalAmount=0.
  const partyServices =
    d.group === "Candidate"
      ? normaliseServices(d.partyServices, d.serviceIds)
      : [];
  if (d.group === "Candidate") {
    if (partyServices.length === 0) {
      return NextResponse.json({ error: "service_required" }, { status: 400 });
    }
    if (!d.sourceId || d.sourceId.length === 0) {
      return NextResponse.json({ error: "source_required" }, { status: 400 });
    }
    const sourceExists = await prisma.leadPulseSource.findUnique({
      where: { id: d.sourceId },
      select: { id: true },
    });
    if (!sourceExists)
      return NextResponse.json({ error: "source_not_found" }, { status: 400 });
    const found = await prisma.service.findMany({
      where: { id: { in: partyServices.map((p) => p.serviceId) } },
      select: { id: true },
    });
    if (found.length !== partyServices.length) {
      return NextResponse.json({ error: "service_not_found" }, { status: 400 });
    }
  }

  const created = await prisma.party.create({
    data: {
      name,
      group: d.group,
      txTypes: d.txTypes,
      email: d.email && d.email.length > 0 ? d.email.trim().toLowerCase() : null,
      phone: d.phone && d.phone.length > 0 ? d.phone.trim() : null,
      notes: d.notes && d.notes.length > 0 ? d.notes.trim() : null,
      isActive: d.isActive,
      sourceId: d.group === "Candidate" && d.sourceId ? d.sourceId : null,
      partyServices: {
        create: partyServices.map((ps) => ({
          serviceId: ps.serviceId,
          totalAmount: ps.totalAmount,
          notes: ps.notes && ps.notes.length > 0 ? ps.notes : null,
        })),
      },
    },
  });
  await recordAudit({
    entityType: "Party",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { name, group: d.group, sourceId: d.sourceId, partyServices },
  });
  return NextResponse.json({ party: created });
}

function normaliseServices(
  partyServices: Array<{ serviceId: string; totalAmount: number; notes?: string }> | undefined,
  serviceIds: string[] | undefined,
): Array<{ serviceId: string; totalAmount: number; notes?: string }> {
  if (partyServices && partyServices.length > 0) {
    const seen = new Set<string>();
    const out: Array<{ serviceId: string; totalAmount: number; notes?: string }> = [];
    for (const ps of partyServices) {
      if (seen.has(ps.serviceId)) continue;
      seen.add(ps.serviceId);
      out.push({ serviceId: ps.serviceId, totalAmount: ps.totalAmount, notes: ps.notes });
    }
    return out;
  }
  if (serviceIds && serviceIds.length > 0) {
    const unique = Array.from(new Set(serviceIds));
    return unique.map((serviceId) => ({ serviceId, totalAmount: 0 }));
  }
  return [];
}
