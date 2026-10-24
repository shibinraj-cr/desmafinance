import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, conflict } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const [rows, counts] = await Promise.all([
    prisma.crmLeadQualityReason.findMany({ orderBy: [{ displayOrder: "asc" }, { label: "asc" }] }),
    prisma.lead.groupBy({ by: ["qualityReasonId"], _count: true, where: { qualityReasonId: { not: null } } }),
  ]);
  const countMap = new Map(counts.map((c) => [c.qualityReasonId, c._count]));
  return NextResponse.json({
    reasons: rows.map((q) => ({ ...q, leadCount: countMap.get(q.id) ?? 0 })),
  });
});

const CreateSchema = z.object({
  label: z.string().trim().min(1).max(80),
  displayOrder: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const d = CreateSchema.parse(await req.json().catch(() => null));
  const existing = await prisma.crmLeadQualityReason.findUnique({ where: { label: d.label } });
  if (existing) throw conflict("A reason with that label already exists.", "label_taken");

  const created = await prisma.crmLeadQualityReason.create({
    data: { label: d.label, displayOrder: d.displayOrder, active: d.active },
  });
  await recordAudit({ entityType: "CrmLeadQualityReason", entityId: created.id, action: "CREATE", userId, changes: { label: d.label } });
  return NextResponse.json({ reason: created }, { status: 201 });
});
