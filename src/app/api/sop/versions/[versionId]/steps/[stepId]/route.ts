import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { StepSchema } from "@/lib/sop/schemas";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { recordSopAudit } from "@/lib/sop/audit";
import { slaToMinutes } from "@/lib/sop/constants";
import { renumberSteps, stepCreateData, validateStepReferences } from "@/lib/sop/steps";

export const dynamic = "force-dynamic";

type Ctx = { params: { versionId: string; stepId: string } };

/**
 * PATCH — replace one step's content, including its whole checklist.
 *
 * The checklist is replaced rather than diffed: the editor edits it as a list,
 * a diff would need stable client-side ids for rows that do not exist yet, and
 * a checklist is small enough that rewriting it is cheaper than the machinery
 * to avoid rewriting it.
 */
export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const step = await prisma.sopStep.findFirst({
    where: { id: params.stepId, versionId: version.id },
  });
  if (!step) throw notFound("Step not found.");

  const d = StepSchema.parse(await req.json().catch(() => null));
  await validateStepReferences(d);

  const updated = await prisma.$transaction(async (tx) => {
    if (d.checklist !== undefined) {
      await tx.sopStepChecklist.deleteMany({ where: { stepId: step.id } });
      if (d.checklist.length > 0) {
        await tx.sopStepChecklist.createMany({
          data: d.checklist.map((c, i) => ({
            stepId: step.id,
            seq: i + 1,
            text: c.text,
            isMandatory: c.isMandatory,
          })),
        });
      }
    }
    return tx.sopStep.update({
      where: { id: step.id },
      data: { ...stepCreateData(d), slaMinutes: slaToMinutes(d.slaValue, d.slaUnit) },
      include: { checklists: { orderBy: { seq: "asc" } } },
    });
  });

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "STEP_UPDATED",
    field: `step:${step.seq}`,
    oldValue: step.title,
    newValue: d.title,
  });

  return NextResponse.json({ step: updated });
});

/** POST — duplicate the step, inserted directly after the original. */
export const POST = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const step = await prisma.sopStep.findFirst({
    where: { id: params.stepId, versionId: version.id },
    include: { checklists: { orderBy: { seq: "asc" } } },
  });
  if (!step) throw notFound("Step not found.");

  const created = await prisma.$transaction(async (tx) => {
    // Make room: everything after the original shifts down one. Done from the
    // bottom up so no two rows ever hold the same seq mid-shift.
    const after = await tx.sopStep.findMany({
      where: { versionId: version.id, seq: { gt: step.seq } },
      orderBy: { seq: "desc" },
      select: { id: true, seq: true },
    });
    for (const s of after) {
      await tx.sopStep.update({ where: { id: s.id }, data: { seq: s.seq + 1 } });
    }

    return tx.sopStep.create({
      data: {
        versionId: version.id,
        seq: step.seq + 1,
        title: `${step.title} (copy)`,
        instruction: step.instruction,
        responsibleRoleId: step.responsibleRoleId,
        responsibleRoleName: step.responsibleRoleName,
        responsibleDepartmentId: step.responsibleDepartmentId,
        assignedEmployeeId: step.assignedEmployeeId,
        slaValue: step.slaValue,
        slaUnit: step.slaUnit,
        slaMinutes: step.slaMinutes,
        requiredInput: step.requiredInput,
        expectedOutput: step.expectedOutput,
        evidence: step.evidence,
        supportingDocument: step.supportingDocument,
        templateRef: step.templateRef,
        linkUrl: step.linkUrl,
        notes: step.notes,
        checklists: {
          create: step.checklists.map((c) => ({
            seq: c.seq,
            text: c.text,
            isMandatory: c.isMandatory,
          })),
        },
      },
      include: { checklists: { orderBy: { seq: "asc" } } },
    });
  });

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "STEP_ADDED",
    newValue: created.title,
    metadata: { duplicatedFrom: step.id },
  });

  return NextResponse.json({ step: created }, { status: 201 });
});

/** DELETE — remove the step and close the gap in the numbering. */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const step = await prisma.sopStep.findFirst({
    where: { id: params.stepId, versionId: version.id },
  });
  if (!step) throw notFound("Step not found.");

  await prisma.sopStep.delete({ where: { id: step.id } });
  await renumberSteps(version.id);

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "STEP_DELETED",
    oldValue: `${step.seq}. ${step.title}`,
  });

  return NextResponse.json({ ok: true });
});
