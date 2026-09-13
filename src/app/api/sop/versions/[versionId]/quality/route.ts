import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireSopAccess } from "@/lib/sop/access";
import { QualityCriterionSchema } from "@/lib/sop/schemas";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { nextChildSeq } from "@/lib/sop/steps";
import { recordSopAudit } from "@/lib/sop/audit";

export const dynamic = "force-dynamic";

/** POST — add a quality criterion to the definition-of-done table. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { versionId: string } }) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const d = QualityCriterionSchema.parse(await req.json().catch(() => null));

  const created = await prisma.sopQualityCriterion.create({
    data: {
      versionId: version.id,
      seq: await nextChildSeq("sopQualityCriterion", version.id),
      criterion: d.criterion,
      target: d.target ?? null,
      isMandatory: d.isMandatory,
    },
  });

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "DRAFT_EDITED",
    field: "qualityCriterion",
    newValue: d.criterion,
  });

  return NextResponse.json({ criterion: created }, { status: 201 });
});
