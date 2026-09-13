import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { ReorderSchema, StepSchema } from "@/lib/sop/schemas";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { recordSopAudit } from "@/lib/sop/audit";
import { slaToMinutes } from "@/lib/sop/constants";
import { stepCreateData, validateStepReferences } from "@/lib/sop/steps";

export const dynamic = "force-dynamic";

type Ctx = { params: { versionId: string } };

/** POST — append a step (seq = max + 1). */
export const POST = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const d = StepSchema.parse(await req.json().catch(() => null));
  await validateStepReferences(d);

  const agg = await prisma.sopStep.aggregate({
    where: { versionId: version.id },
    _max: { seq: true },
  });
  const seq = (agg._max.seq ?? 0) + 1;

  const created = await prisma.sopStep.create({
    data: {
      versionId: version.id,
      seq,
      ...stepCreateData(d),
      slaMinutes: slaToMinutes(d.slaValue, d.slaUnit),
      ...(d.checklist?.length
        ? {
            checklists: {
              create: d.checklist.map((c, i) => ({
                seq: i + 1,
                text: c.text,
                isMandatory: c.isMandatory,
              })),
            },
          }
        : {}),
    },
    include: { checklists: { orderBy: { seq: "asc" } } },
  });

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "STEP_ADDED",
    newValue: `${seq}. ${d.title}`,
  });

  return NextResponse.json({ step: created }, { status: 201 });
});

/**
 * PUT — reorder. Body: `{ orderedIds }`, the complete ordered list.
 *
 * Two passes, because `@@unique([versionId, seq])` would reject an intermediate
 * state where two steps briefly share a number. Same technique the Operations
 * template reorder uses, and for the same constraint.
 */
export const PUT = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const { orderedIds } = ReorderSchema.parse(await req.json().catch(() => null));

  const steps = await prisma.sopStep.findMany({
    where: { versionId: version.id },
    select: { id: true },
  });
  const existing = new Set(steps.map((s) => s.id));
  if (orderedIds.length !== steps.length || !orderedIds.every((id) => existing.has(id))) {
    throw badRequest("orderedIds must list exactly this version's steps.", "bad_order");
  }

  await prisma.$transaction(async (tx) => {
    // Pass 1: park every step above the range any final seq can occupy.
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.sopStep.update({ where: { id: orderedIds[i]! }, data: { seq: 10_000 + i } });
    }
    // Pass 2: assign the final, contiguous 1-based numbers.
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.sopStep.update({ where: { id: orderedIds[i]! }, data: { seq: i + 1 } });
    }
  });

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "STEPS_REORDERED",
    newValue: `${orderedIds.length} steps`,
  });

  const updated = await prisma.sopStep.findMany({
    where: { versionId: version.id },
    orderBy: { seq: "asc" },
    include: { checklists: { orderBy: { seq: "asc" } } },
  });
  return NextResponse.json({ steps: updated });
});
