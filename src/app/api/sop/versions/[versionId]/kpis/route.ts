import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { KpiSchema } from "@/lib/sop/schemas";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { nextChildSeq } from "@/lib/sop/steps";
import { recordSopAudit } from "@/lib/sop/audit";

export const dynamic = "force-dynamic";

/** POST — define a KPI on this version. */
export const POST = withApiHandler(async (req: Request, { params }: { params: { versionId: string } }) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const d = KpiSchema.parse(await req.json().catch(() => null));

  if (d.kpiOwnerEmployeeId) {
    const owner = await prisma.employee.count({
      where: { id: d.kpiOwnerEmployeeId, active: true },
    });
    if (owner === 0) throw badRequest("The KPI owner must be an active employee.", "bad_employee");
  }

  const created = await prisma.sopKpi.create({
    data: {
      versionId: version.id,
      seq: await nextChildSeq("sopKpi", version.id),
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
    newValue: d.name,
  });

  return NextResponse.json({ kpi: created }, { status: 201 });
});
