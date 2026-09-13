import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { QualityCriterionSchema } from "@/lib/sop/schemas";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { renumberVersionChildren } from "@/lib/sop/steps";
import { recordSopAudit } from "@/lib/sop/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { versionId: string; itemId: string } };

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const existing = await prisma.sopQualityCriterion.findFirst({
    where: { id: params.itemId, versionId: version.id },
  });
  if (!existing) throw notFound("Quality criterion not found.");

  const d = QualityCriterionSchema.parse(await req.json().catch(() => null));
  const updated = await prisma.sopQualityCriterion.update({
    where: { id: existing.id },
    data: { criterion: d.criterion, target: d.target ?? null, isMandatory: d.isMandatory },
  });

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "DRAFT_EDITED",
    field: "qualityCriterion",
    oldValue: existing.criterion,
    newValue: d.criterion,
  });

  return NextResponse.json({ criterion: updated });
});

export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const existing = await prisma.sopQualityCriterion.findFirst({
    where: { id: params.itemId, versionId: version.id },
  });
  if (!existing) throw notFound("Quality criterion not found.");

  await prisma.sopQualityCriterion.delete({ where: { id: existing.id } });
  await renumberVersionChildren("sopQualityCriterion", version.id);

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "DRAFT_EDITED",
    field: "qualityCriterion",
    oldValue: existing.criterion,
    newValue: null,
  });

  return NextResponse.json({ ok: true });
});
