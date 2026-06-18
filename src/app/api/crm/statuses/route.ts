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

  const [statuses, counts] = await Promise.all([
    prisma.crmLeadStatus.findMany({ orderBy: [{ displayOrder: "asc" }, { label: "asc" }] }),
    prisma.lead.groupBy({ by: ["statusId"], _count: true }),
  ]);
  const countMap = new Map(counts.map((c) => [c.statusId, c._count]));
  return NextResponse.json({
    statuses: statuses.map((s) => ({ ...s, leadCount: countMap.get(s.id) ?? 0 })),
  });
});

const CreateSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/, "lowercase letters, digits, underscore"),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(["active", "won", "lost"]).default("active"),
  displayOrder: z.number().int().min(0).default(0),
  color: z.string().trim().max(20).nullable().optional(),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const d = CreateSchema.parse(await req.json().catch(() => null));
  const code = d.code.toLowerCase();

  const existing = await prisma.crmLeadStatus.findUnique({ where: { code } });
  if (existing) throw conflict("A status with that code already exists.", "code_taken");

  const created = await prisma.$transaction(async (tx) => {
    if (d.isDefault) await tx.crmLeadStatus.updateMany({ data: { isDefault: false } });
    return tx.crmLeadStatus.create({
      data: {
        code,
        label: d.label,
        kind: d.kind,
        displayOrder: d.displayOrder,
        color: d.color ?? null,
        isDefault: d.isDefault,
        active: d.active,
      },
    });
  });

  await recordAudit({ entityType: "CrmLeadStatus", entityId: created.id, action: "CREATE", userId, changes: { code, label: d.label } });
  return NextResponse.json({ status: created }, { status: 201 });
});
