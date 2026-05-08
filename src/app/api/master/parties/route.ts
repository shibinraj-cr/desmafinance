import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const CreateSchema = z.object({
  name: z.string().min(2).max(160),
  group: z.enum(["Candidate", "Vendor"]),
  txTypes: z.enum(["Revenue", "Expense", "Both"]).default("Both"),
  email: z.string().email().max(120).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const txType = searchParams.get("txType"); // optional filter for the form dropdown
  const group = searchParams.get("group");
  const onlyActive = searchParams.get("active") !== "false";

  const where = {
    ...(onlyActive ? { isActive: true } : {}),
    ...(group ? { group } : {}),
    ...(txType
      ? {
          OR: [{ txTypes: txType }, { txTypes: "Both" }],
        }
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
  // Anyone authenticated who can record transactions can also create a party
  // on the fly — lets executives add a new candidate while entering a tx.
  // Master-data UI is admin-only but inline-create from the tx form is open.

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  const d = parsed.data;
  const name = d.name.trim();

  const existing = await prisma.party.findUnique({ where: { name } });
  if (existing) return NextResponse.json({ error: "name_taken" }, { status: 409 });

  const created = await prisma.party.create({
    data: {
      name,
      group: d.group,
      txTypes: d.txTypes,
      email: d.email && d.email.length > 0 ? d.email.trim().toLowerCase() : null,
      phone: d.phone && d.phone.length > 0 ? d.phone.trim() : null,
      notes: d.notes && d.notes.length > 0 ? d.notes.trim() : null,
      isActive: d.isActive,
    },
  });
  await recordAudit({
    entityType: "Party",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { name, group: d.group, txTypes: d.txTypes },
  });
  return NextResponse.json({ party: created });
}
