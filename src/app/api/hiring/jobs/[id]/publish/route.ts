import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { publishJob } from "@/lib/hiring/jobs";

export const dynamic = "force-dynamic";

// POST /api/hiring/jobs/[id]/publish
export const POST = withApiHandler(async (_req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("job:write");
  const outcome = await publishJob(params.id);

  if (outcome.published || outcome.status === "pending_approval") {
    await recordHiringAudit({
      actorId: access.userId,
      action: outcome.published ? "job.publish" : "job.route_for_approval",
      entityType: "HiringJob",
      entityId: params.id,
      after: { status: outcome.status },
    });
  }

  // Not an error: "we could not publish this yet, and here is exactly why" is a
  // normal answer the wizard renders as a checklist.
  return NextResponse.json({ outcome });
});
