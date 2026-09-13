import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireSopAccess } from "@/lib/sop/access";
import { PublishSchema } from "@/lib/sop/schemas";
import { publishVersion } from "@/lib/sop/workflow";

export const dynamic = "force-dynamic";

/**
 * POST /api/sop/versions/[versionId]/publish — take an approved version live.
 *
 * Its own route rather than another `workflow` action because publishing takes
 * a payload the other transitions do not: effective date, audience, whether
 * acknowledgement is required and by when. All of the rules — approved-only,
 * SOP-admin-only, an audience when acknowledgement is required — are in
 * `publishVersion`.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { versionId: string } }) => {
  const access = await requireSopAccess();
  const d = PublishSchema.parse(await req.json().catch(() => null));

  const result = await publishVersion(params.versionId, access, {
    effectiveDate: d.effectiveDate,
    nextReviewDate: d.nextReviewDate ?? null,
    applicableDepartmentIds: d.applicableDepartmentIds,
    applicableRoleIds: d.applicableRoleIds,
    applicableEmployeeIds: d.applicableEmployeeIds,
    requiresAcknowledgement: d.requiresAcknowledgement,
    acknowledgementDeadline: d.acknowledgementDeadline ?? null,
    publishNotes: d.publishNotes ?? null,
  });

  return NextResponse.json(result);
});
