/**
 * Step helpers shared by the step routes.
 *
 * `stepCreateData` is the single mapping from the validated payload to the
 * column set, so add / update / duplicate cannot drift apart — which is exactly
 * how a "duplicate step" quietly stops copying the field someone added last
 * month.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/http-error";
import type { StepInput } from "./schemas";

/** Payload → column values (SLA minutes and checklists are handled by callers). */
export function stepCreateData(d: StepInput) {
  return {
    title: d.title,
    instruction: d.instruction ?? null,
    responsibleRoleId: d.responsibleRoleId ?? null,
    responsibleRoleName: d.responsibleRoleName ?? null,
    responsibleDepartmentId: d.responsibleDepartmentId ?? null,
    assignedEmployeeId: d.assignedEmployeeId ?? null,
    slaValue: d.slaValue ?? null,
    slaUnit: d.slaUnit ?? null,
    requiredInput: d.requiredInput ?? null,
    expectedOutput: d.expectedOutput ?? null,
    evidence: d.evidence ?? null,
    supportingDocument: d.supportingDocument ?? null,
    templateRef: d.templateRef ?? null,
    linkUrl: d.linkUrl ?? null,
    notes: d.notes ?? null,
  };
}

/**
 * Ids on a step must point at live master rows.
 *
 * A step naming a deactivated employee would look assigned but be
 * unassignable the day the workflow engine tries to mint a task from it, so
 * this is checked at authoring time rather than discovered later.
 */
export async function validateStepReferences(d: {
  responsibleRoleId?: string | null;
  responsibleDepartmentId?: string | null;
  assignedEmployeeId?: string | null;
  escalateToRoleId?: string | null;
  escalateToEmployeeId?: string | null;
}): Promise<void> {
  const checks: Promise<void>[] = [];

  const roleIds = [d.responsibleRoleId, d.escalateToRoleId].filter((v): v is string => !!v);
  if (roleIds.length) {
    checks.push(
      prisma.hrRole.count({ where: { id: { in: roleIds }, active: true } }).then((n) => {
        if (n !== new Set(roleIds).size) throw badRequest("A role was not found.", "bad_role");
      }),
    );
  }
  if (d.responsibleDepartmentId) {
    checks.push(
      prisma.hrDepartment
        .count({ where: { id: d.responsibleDepartmentId, active: true } })
        .then((n) => {
          if (n === 0) throw badRequest("The department was not found.", "bad_department");
        }),
    );
  }
  const employeeIds = [d.assignedEmployeeId, d.escalateToEmployeeId].filter(
    (v): v is string => !!v,
  );
  if (employeeIds.length) {
    checks.push(
      prisma.employee.count({ where: { id: { in: employeeIds }, active: true } }).then((n) => {
        if (n !== new Set(employeeIds).size) {
          throw badRequest("An employee was not found or is inactive.", "bad_employee");
        }
      }),
    );
  }

  await Promise.all(checks);
}

/**
 * Renumber a version's steps contiguously from 1.
 *
 * Called after a delete so the numbering the reader sees never has a hole. Two
 * passes for the same `@@unique([versionId, seq])` reason as the reorder route.
 */
export async function renumberSteps(versionId: string): Promise<void> {
  const steps = await prisma.sopStep.findMany({
    where: { versionId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true },
  });
  const needsWork = steps.some((s, i) => s.seq !== i + 1);
  if (!needsWork) return;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < steps.length; i++) {
      await tx.sopStep.update({ where: { id: steps[i]!.id }, data: { seq: 10_000 + i } });
    }
    for (let i = 0; i < steps.length; i++) {
      await tx.sopStep.update({ where: { id: steps[i]!.id }, data: { seq: i + 1 } });
    }
  });
}

/**
 * The three `seq`-ordered child collections of a version. They share the same
 * `@@unique([versionId, seq])` shape, but Prisma's per-model delegate types do
 * not unify, so the dispatch below is an explicit switch rather than a generic:
 * a generic would need a cast that throws away exactly the type safety these
 * helpers exist to preserve.
 */
export type VersionChildModel = "sopQualityCriterion" | "sopException" | "sopKpi";

/** Current (id, seq) rows of a child collection, in order. */
async function childRows(
  model: VersionChildModel,
  versionId: string,
): Promise<{ id: string; seq: number }[]> {
  const args = { where: { versionId }, orderBy: { seq: "asc" }, select: { id: true, seq: true } } as const;
  switch (model) {
    case "sopQualityCriterion":
      return prisma.sopQualityCriterion.findMany(args);
    case "sopException":
      return prisma.sopException.findMany(args);
    case "sopKpi":
      return prisma.sopKpi.findMany(args);
  }
}

async function setChildSeq(
  tx: Prisma.TransactionClient,
  model: VersionChildModel,
  id: string,
  seq: number,
): Promise<void> {
  switch (model) {
    case "sopQualityCriterion":
      await tx.sopQualityCriterion.update({ where: { id }, data: { seq } });
      return;
    case "sopException":
      await tx.sopException.update({ where: { id }, data: { seq } });
      return;
    case "sopKpi":
      await tx.sopKpi.update({ where: { id }, data: { seq } });
      return;
  }
}

/**
 * Renumber a child collection contiguously from 1 after a delete, so the
 * numbering a reader sees never has a hole.
 *
 * Two passes for the same unique-constraint reason as `renumberSteps`.
 */
export async function renumberVersionChildren(
  model: VersionChildModel,
  versionId: string,
): Promise<void> {
  const rows = await childRows(model, versionId);
  if (!rows.some((r, i) => r.seq !== i + 1)) return;

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < rows.length; i++) await setChildSeq(tx, model, rows[i]!.id, 10_000 + i);
    for (let i = 0; i < rows.length; i++) await setChildSeq(tx, model, rows[i]!.id, i + 1);
  });
}

/** The next free `seq` in a version's child collection. */
export async function nextChildSeq(model: VersionChildModel, versionId: string): Promise<number> {
  const rows = await childRows(model, versionId);
  return rows.reduce((max, r) => Math.max(max, r.seq), 0) + 1;
}
