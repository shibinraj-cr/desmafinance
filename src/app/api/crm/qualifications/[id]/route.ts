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
  label: z.string().trim().min(1).max(80).optional(),
  displayOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const existing = await prisma.crmQualification.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const d = PatchSchema.parse(await req.json().catch(() => null));
  const update: Record<string, unknown> = {};
  if (d.label !== undefined && d.label !== existing.label) {
    const clash = await prisma.crmQualification.findUnique({ where: { label: d.label } });
    if (clash) throw conflict("A qualification with that label already exists.", "label_taken");
    update.label = d.label;
  }
  if (d.displayOrder !== undefined) update.displayOrder = d.displayOrder;
  if (d.active !== undefined) update.active = d.active;

  const updated = await prisma.crmQualification.update({ where: { id: params.id }, data: update });
  await recordAudit({
    entityType: "CrmQualification",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { before: existing, after: d },
  });
  return NextResponse.json({ qualification: updated });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const existing = await prisma.crmQualification.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const leadCount = await prisma.lead.count({ where: { qualificationId: params.id } });
  if (leadCount > 0) {
    throw conflict(
      `This qualification is used by ${leadCount} lead${leadCount === 1 ? "" : "s"}. Deactivate it instead.`,
      "in_use",
    );
  }

  await prisma.crmQualification.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "CrmQualification",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { label: existing.label },
  });
  return NextResponse.json({ ok: true });
});
