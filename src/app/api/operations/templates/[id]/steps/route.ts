import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess } from "@/lib/ops-rbac";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  phase: z.string().trim().max(80).nullable().optional(),
  isRequired: z.boolean().default(true),
  slaDays: z.number().int().min(0).max(3650).nullable().optional(),
});

// Add a step to a template — appended at the end (seq = max + 1).
export const POST = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canManageTemplates) throw forbidden();

  const template = await prisma.processTemplate.findUnique({ where: { id: params.id } });
  if (!template) throw notFound();

  const d = CreateSchema.parse(await req.json().catch(() => null));

  const agg = await prisma.processTemplateStep.aggregate({
    where: { templateId: params.id },
    _max: { seq: true },
  });
  const seq = (agg._max.seq ?? 0) + 1;

  const created = await prisma.processTemplateStep.create({
    data: {
      templateId: params.id,
      seq,
      name: d.name,
      description: d.description ?? null,
      phase: d.phase ?? null,
      isRequired: d.isRequired,
      slaDays: d.slaDays ?? null,
    },
  });

  await recordAudit({
    entityType: "ProcessTemplateStep",
    entityId: created.id,
    action: "CREATE",
    userId,
    changes: { templateId: params.id, name: d.name, seq },
  });
  return NextResponse.json({ step: created }, { status: 201 });
});

const ReorderSchema = z.object({ orderedIds: z.array(z.string()).min(1) });

// Reorder a template's steps. Body: { orderedIds } — the full ordered list of
// step ids; each step's seq is reassigned to its 1-based position. Done in two
// passes (offset then final) so the @@unique([templateId, seq]) constraint is
// never violated mid-update.
export const PUT = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!getOpsAccess(userId, perms).canManageTemplates) throw forbidden();

  const template = await prisma.processTemplate.findUnique({ where: { id: params.id } });
  if (!template) throw notFound();

  const { orderedIds } = ReorderSchema.parse(await req.json().catch(() => null));

  const steps = await prisma.processTemplateStep.findMany({
    where: { templateId: params.id },
    select: { id: true },
  });
  const existingIds = new Set(steps.map((s) => s.id));
  if (orderedIds.length !== steps.length || !orderedIds.every((id) => existingIds.has(id))) {
    throw badRequest("orderedIds must list exactly the template's steps.", "bad_order");
  }

  await prisma.$transaction(async (tx) => {
    // Pass 1: move out of the way to avoid unique-collisions with final seqs.
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.processTemplateStep.update({ where: { id: orderedIds[i] }, data: { seq: 10000 + i } });
    }
    // Pass 2: assign final 1-based seqs.
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.processTemplateStep.update({ where: { id: orderedIds[i] }, data: { seq: i + 1 } });
    }
  });

  await recordAudit({
    entityType: "ProcessTemplate",
    entityId: params.id,
    action: "UPDATE",
    userId,
    changes: { reordered: orderedIds },
  });
  return NextResponse.json({ ok: true });
});
