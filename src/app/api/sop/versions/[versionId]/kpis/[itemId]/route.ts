import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, notFound } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { KpiSchema } from "@/lib/sop/schemas";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { renumberVersionChildren } from "@/lib/sop/steps";
import { recordSopAudit } from "@/lib/sop/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { versionId: string; itemId: string } };

export const PATCH = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const existing = await prisma.sopKpi.findFirst({
    where: { id: params.itemId, versionId: version.id },
  });
  if (!existing) throw notFound("KPI not found.");

  const d = KpiSchema.parse(await req.json().catch(() => null));
  if (d.kpiOwnerEmployeeId) {
    const owner = await prisma.employee.count({ where: { id: d.kpiOwnerEmployeeId, active: true } });
    if (owner === 0) throw badRequest("The KPI owner must be an active employee.", "bad_employee");
  }

  const updated = await prisma.sopKpi.update({
    where: { id: existing.id },
    data: {
      name: d.name,
      description: d.description ?? null,
      target: d.target ?? null,
      unit: d.unit ?? null,
      measurementMethod: d.measurementMethod ?? null,
      dataSource: d.dataSource ?? null,
      reviewFrequency: d.reviewFrequency ?? null,
      kpiOwnerEmployeeId: d.kpiOwnerEmployeeId ?? null,
    },
  });

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "KPI_UPDATED",
    field: "kpi",
    oldValue: existing.name,
    newValue: d.name,
  });

  return NextResponse.json({ kpi: updated });
});

/**
 * DELETE — remove a KPI definition. Its recorded reviews go with it (the FK
 * cascades): a measurement of a KPI that no longer exists has nothing to be
 * measured against, and keeping orphans would only make the KPI page lie.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const existing = await prisma.sopKpi.findFirst({
    where: { id: params.itemId, versionId: version.id },
  });
  if (!existing) throw notFound("KPI not found.");

  await prisma.sopKpi.delete({ where: { id: existing.id } });
  await renumberVersionChildren("sopKpi", version.id);

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "KPI_UPDATED",
    field: "kpi",
    oldValue: existing.name,
    newValue: null,
  });

  return NextResponse.json({ ok: true });
});
