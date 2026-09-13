import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { ExceptionSchema } from "@/lib/sop/schemas";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { renumberVersionChildren, validateStepReferences } from "@/lib/sop/steps";
import { recordSopAudit } from "@/lib/sop/audit";
import { slaToMinutes } from "@/lib/sop/constants";

export const dynamic = "force-dynamic";

type Ctx = { params: { versionId: string; itemId: string } };

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const existing = await prisma.sopException.findFirst({
    where: { id: params.itemId, versionId: version.id },
  });
  if (!existing) throw notFound("Exception not found.");

  const d = ExceptionSchema.parse(await req.json().catch(() => null));
  await validateStepReferences(d);

  const updated = await prisma.sopException.update({
    where: { id: existing.id },
    data: {
      issue: d.issue,
      condition: d.condition ?? null,
      requiredAction: d.requiredAction ?? null,
      escalateToRoleId: d.escalateToRoleId ?? null,
      escalateToRoleName: d.escalateToRoleName ?? null,
      escalateToEmployeeId: d.escalateToEmployeeId ?? null,
      escalationSla: d.escalationSla ?? null,
      escalationUnit: d.escalationUnit ?? null,
      escalationMinutes: slaToMinutes(d.escalationSla, d.escalationUnit),
      priority: d.priority,
      notifyProcessOwner: d.notifyProcessOwner,
      notifyDepartmentHead: d.notifyDepartmentHead,
    },
  });

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "DRAFT_EDITED",
    field: "exception",
    oldValue: existing.issue,
    newValue: d.issue,
  });

  return NextResponse.json({ exception: updated });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const existing = await prisma.sopException.findFirst({
    where: { id: params.itemId, versionId: version.id },
  });
  if (!existing) throw notFound("Exception not found.");

  await prisma.sopException.delete({ where: { id: existing.id } });
  await renumberVersionChildren("sopException", version.id);

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "DRAFT_EDITED",
    field: "exception",
    oldValue: existing.issue,
    newValue: null,
  });

  return NextResponse.json({ ok: true });
});
