import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess } from "@/lib/ops-rbac";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; stepId: string } };

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  phase: z.string().trim().max(80).nullable().optional(),
  isRequired: z.boolean().optional(),
  slaDays: z.number().int().min(0).max(3650).nullable().optional(),
});

async function loadStep(templateId: string, stepId: string) {
  const step = await prisma.processTemplateStep.findUnique({ where: { id: stepId } });
  if (!step || step.templateId !== templateId) throw notFound();
  return step;
}

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canManageTemplates) throw forbidden();

  await loadStep(params.id, params.stepId);
  const d = PatchSchema.parse(await req.json().catch(() => null));

  const updated = await prisma.processTemplateStep.update({
    where: { id: params.stepId },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.phase !== undefined ? { phase: d.phase } : {}),
      ...(d.isRequired !== undefined ? { isRequired: d.isRequired } : {}),
      ...(d.slaDays !== undefined ? { slaDays: d.slaDays } : {}),
    },
  });

  await recordAudit({
    entityType: "ProcessTemplateStep",
    entityId: updated.id,
    action: "UPDATE",
    userId,
    changes: { after: d },
  });
  return NextResponse.json({ step: updated });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canManageTemplates) throw forbidden();

  const step = await loadStep(params.id, params.stepId);
  await prisma.processTemplateStep.delete({ where: { id: params.stepId } });

  await recordAudit({
    entityType: "ProcessTemplateStep",
    entityId: params.stepId,
    action: "DELETE",
    userId,
    changes: { templateId: params.id, name: step.name },
  });
  return NextResponse.json({ ok: true });
});
