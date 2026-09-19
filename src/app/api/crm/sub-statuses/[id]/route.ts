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
  group: z.string().trim().max(40).optional(),
  displayOrder: z.number().int().min(0).optional(),
  color: z.string().trim().max(9).nullable().optional(),
  active: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const existing = await prisma.crmLeadSubStatus.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const d = PatchSchema.parse(await req.json().catch(() => null));
  const update: Record<string, unknown> = {};
  if (d.label !== undefined && d.label !== existing.label) {
    const clash = await prisma.crmLeadSubStatus.findFirst({
      where: { label: d.label, id: { not: params.id } },
    });
    if (clash) throw conflict("A status with that label already exists.", "label_taken");
    update.label = d.label;
  }
  if (d.group !== undefined) update.group = d.group;
  if (d.displayOrder !== undefined) update.displayOrder = d.displayOrder;
  if (d.color !== undefined) update.color = d.color;
  if (d.active !== undefined) update.active = d.active;

  // Exactly one default. Promoting one demotes the rest in the same transaction,
  // so a new lead can never find two candidates for its starting status (or,
  // worse, none because someone deactivated the old default).
  const promoting = d.isDefault === true && !existing.isDefault;
  if (promoting) {
    update.isDefault = true;
    update.active = true;
  } else if (d.isDefault === false && existing.isDefault) {
    throw conflict(
      "Every new lead has to start somewhere — make another status the default instead of clearing this one.",
      "default_required",
    );
  }

  const updated = promoting
    ? await prisma.$transaction(async (tx) => {
        await tx.crmLeadSubStatus.updateMany({
          where: { isDefault: true, id: { not: params.id } },
          data: { isDefault: false },
        });
        return tx.crmLeadSubStatus.update({ where: { id: params.id }, data: update });
      })
    : await prisma.crmLeadSubStatus.update({ where: { id: params.id }, data: update });

  await recordAudit({
    entityType: "CrmLeadSubStatus",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { before: existing, after: d },
  });
  return NextResponse.json({ subStatus: updated });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const existing = await prisma.crmLeadSubStatus.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();
  if (existing.isDefault) {
    throw conflict(
      "This is the status new leads start in. Make another status the default first.",
      "is_default",
    );
  }

  const leadCount = await prisma.lead.count({ where: { subStatusId: params.id } });
  if (leadCount > 0) {
    throw conflict(
      `This status is used by ${leadCount} lead${leadCount === 1 ? "" : "s"}. Deactivate it instead.`,
      "in_use",
    );
  }

  await prisma.crmLeadSubStatus.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "CrmLeadSubStatus",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { label: existing.label },
  });
  return NextResponse.json({ ok: true });
});
