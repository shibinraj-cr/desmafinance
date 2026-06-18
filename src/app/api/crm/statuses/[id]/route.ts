import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, conflict } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const PatchSchema = z.object({
  code: z.string().trim().min(2).max(40).regex(/^[a-z0-9_]+$/).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  kind: z.enum(["active", "won", "lost"]).optional(),
  displayOrder: z.number().int().min(0).optional(),
  color: z.string().trim().max(20).nullable().optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const existing = await prisma.crmLeadStatus.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const d = PatchSchema.parse(await req.json().catch(() => null));

  const update: Record<string, unknown> = {};
  if (d.label !== undefined) update.label = d.label;
  if (d.kind !== undefined) update.kind = d.kind;
  if (d.displayOrder !== undefined) update.displayOrder = d.displayOrder;
  if (d.color !== undefined) update.color = d.color;
  if (d.active !== undefined) update.active = d.active;
  if (d.code !== undefined && d.code.toLowerCase() !== existing.code) {
    const code = d.code.toLowerCase();
    const clash = await prisma.crmLeadStatus.findUnique({ where: { code } });
    if (clash) throw conflict("A status with that code already exists.", "code_taken");
    update.code = code;
  }
  if (d.isDefault !== undefined) update.isDefault = d.isDefault;

  const updated = await prisma.$transaction(async (tx) => {
    if (d.isDefault === true) {
      await tx.crmLeadStatus.updateMany({ where: { id: { not: params.id } }, data: { isDefault: false } });
    }
    return tx.crmLeadStatus.update({ where: { id: params.id }, data: update });
  });

  await recordAudit({
    entityType: "CrmLeadStatus",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { before: existing, after: d },
  });
  return NextResponse.json({ status: updated });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const existing = await prisma.crmLeadStatus.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const leadCount = await prisma.lead.count({ where: { statusId: params.id } });
  if (leadCount > 0) {
    throw conflict(
      `This status is used by ${leadCount} lead${leadCount === 1 ? "" : "s"}. Deactivate it instead.`,
      "in_use",
    );
  }

  await prisma.crmLeadStatus.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "CrmLeadStatus",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { code: existing.code, label: existing.label },
  });
  return NextResponse.json({ ok: true });
});
