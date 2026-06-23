import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, conflict } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess } from "@/lib/ops-rbac";
import { serializeTemplate, opsTemplateInclude } from "@/lib/ops-templates";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

export const GET = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canManageTemplates) throw forbidden();

  const t = await prisma.processTemplate.findUnique({ where: { id: params.id }, include: opsTemplateInclude });
  if (!t) throw notFound();
  return NextResponse.json({ template: serializeTemplate(t) });
});

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canManageTemplates) throw forbidden();

  const existing = await prisma.processTemplate.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const d = PatchSchema.parse(await req.json().catch(() => null));

  const updated = await prisma.$transaction(async (tx) => {
    // Activating this template deactivates every other version for its service
    // so exactly one stays active.
    if (d.isActive === true) {
      await tx.processTemplate.updateMany({
        where: { serviceId: existing.serviceId, id: { not: existing.id } },
        data: { isActive: false },
      });
    }
    return tx.processTemplate.update({
      where: { id: params.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
      },
      include: opsTemplateInclude,
    });
  });

  await recordAudit({
    entityType: "ProcessTemplate",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { before: { name: existing.name, isActive: existing.isActive }, after: d },
  });
  return NextResponse.json({ template: serializeTemplate(updated) });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canManageTemplates) throw forbidden();

  const existing = await prisma.processTemplate.findUnique({ where: { id: params.id } });
  if (!existing) throw notFound();

  const projectCount = await prisma.opsProject.count({ where: { templateId: params.id } });
  if (projectCount > 0) {
    throw conflict(
      `This template is used by ${projectCount} project${projectCount === 1 ? "" : "s"}. Deactivate it instead.`,
      "in_use",
    );
  }

  // Steps cascade-delete with the template (FK onDelete: Cascade).
  await prisma.processTemplate.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "ProcessTemplate",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: { name: existing.name, serviceId: existing.serviceId, version: existing.version },
  });
  return NextResponse.json({ ok: true });
});
