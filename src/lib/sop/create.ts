/**
 * Creating an SOP.
 *
 * Lives in the lib rather than inside the route so the HTTP layer and the
 * verification script drive the SAME code — a script that reimplements creation
 * proves only that the reimplementation works.
 *
 * The `Sop` row and its V1.0 version are written in one transaction: an SOP
 * with no version is not a state any reader should ever observe.
 */

import { prisma } from "@/lib/prisma";
import { badRequest, forbidden } from "@/lib/http-error";
import { recordSopAudit } from "./audit";
import { deptCodeFor, withMintedNumber } from "./numbering";
import type { SopAccess } from "./rbac";
import type { CreateSopInput } from "./schemas";
import { initialVersion, versionLabel } from "./versioning";

export type CreatedSop = {
  sop: { id: string; sopNumber: string };
  version: { id: string; versionLabel: string };
};

export async function createSop(input: CreateSopInput, access: SopAccess): Promise<CreatedSop> {
  if (!access.canCreate) throw forbidden();

  // The pickers come from the employee/department masters, so validate against
  // them rather than trusting the ids the client sent back.
  const [owner, department] = await Promise.all([
    prisma.employee.findFirst({ where: { id: input.ownerEmployeeId, active: true }, select: { id: true } }),
    prisma.hrDepartment.findFirst({ where: { id: input.departmentId, active: true }, select: { id: true } }),
  ]);
  if (!owner) throw badRequest("The SOP owner must be an active employee.", "bad_owner");
  if (!department) throw badRequest("The department was not found.", "bad_department");
  if (input.categoryId) {
    const category = await prisma.sopCategory.findFirst({
      where: { id: input.categoryId, isActive: true },
      select: { id: true },
    });
    if (!category) throw badRequest("The category was not found.", "bad_category");
  }

  const deptCode = await deptCodeFor(input.departmentId);
  const first = initialVersion();

  const created = await withMintedNumber(deptCode, async (minted) =>
    prisma.$transaction(async (tx) => {
      const sop = await tx.sop.create({
        data: {
          sopNumber: minted.sopNumber,
          deptCode: minted.deptCode,
          seq: minted.seq,
          title: input.title,
          departmentId: input.departmentId,
          categoryId: input.categoryId ?? null,
          processFunction: input.processFunction ?? null,
          ownerEmployeeId: input.ownerEmployeeId,
          confidentiality: input.confidentiality,
          status: "draft",
          createdById: access.userId,
        },
      });

      const version = await tx.sopVersion.create({
        data: {
          sopId: sop.id,
          versionLabel: versionLabel(first),
          major: first.major,
          minor: first.minor,
          status: "draft",
          title: input.title,
          departmentId: input.departmentId,
          categoryId: input.categoryId ?? null,
          processFunction: input.processFunction ?? null,
          ownerEmployeeId: input.ownerEmployeeId,
          supportingRoleIds: input.supportingRoleIds,
          confidentiality: input.confidentiality,
          reviewerId: input.reviewerId ?? null,
          approverId: input.approverId ?? null,
          createdById: access.userId,
        },
      });

      await tx.sop.update({ where: { id: sop.id }, data: { draftVersionId: version.id } });
      return { sop, version };
    }),
  );

  await recordSopAudit({
    sopId: created.sop.id,
    versionId: created.version.id,
    versionLabel: created.version.versionLabel,
    userId: access.userId,
    action: "SOP_CREATED",
    newValue: created.sop.sopNumber,
    metadata: { title: input.title, departmentId: input.departmentId },
  });

  return {
    sop: { id: created.sop.id, sopNumber: created.sop.sopNumber },
    version: { id: created.version.id, versionLabel: created.version.versionLabel },
  };
}
