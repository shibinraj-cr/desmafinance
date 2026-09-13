import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireSopAccess } from "@/lib/sop/access";
import { ExceptionSchema } from "@/lib/sop/schemas";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { nextChildSeq, validateStepReferences } from "@/lib/sop/steps";
import { recordSopAudit } from "@/lib/sop/audit";
import { slaToMinutes } from "@/lib/sop/constants";

export const dynamic = "force-dynamic";

/** POST — add a row to the exception & escalation matrix. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { versionId: string } }) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const d = ExceptionSchema.parse(await req.json().catch(() => null));
  await validateStepReferences(d);

  const created = await prisma.sopException.create({
    data: {
      versionId: version.id,
      seq: await nextChildSeq("sopException", version.id),
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
    newValue: `${d.priority}: ${d.issue}`,
  });

  return NextResponse.json({ exception: created }, { status: 201 });
});
