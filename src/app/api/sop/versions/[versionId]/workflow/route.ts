import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { badRequest } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { WorkflowSchema } from "@/lib/sop/schemas";
import {
  decideApproval,
  decideReview,
  requestChanges,
  requestReview,
  submitForApproval,
} from "@/lib/sop/workflow";

export const dynamic = "force-dynamic";

/**
 * POST /api/sop/versions/[versionId]/workflow — advance the lifecycle.
 *
 * One route for every transition, because they share the same authorisation
 * shape and the same "is this legal from here" question. Which of the four
 * handlers runs is decided by `action`; each re-derives authority from
 * `SopAccess` rather than trusting the caller's claim about their role.
 * Publishing has its own route: it takes a settings payload, not a decision.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { versionId: string } }) => {
  const access = await requireSopAccess();
  const d = WorkflowSchema.parse(await req.json().catch(() => null));
  const comments = d.comments ?? null;

  switch (d.action) {
    case "request_review":
      return NextResponse.json(await requestReview(params.versionId, access, comments));

    case "submit_for_approval":
      return NextResponse.json(await submitForApproval(params.versionId, access, comments));

    case "approve_review":
      return NextResponse.json(await decideReview(params.versionId, access, "approve", comments));

    case "approve":
      return NextResponse.json(await decideApproval(params.versionId, access, "approve", comments));

    case "request_changes": {
      if (!comments) throw badRequest("Say what needs changing.", "comments_required");
      // Which gate this is comes from the version's own status, not from the
      // client — see requestChanges().
      return NextResponse.json(await requestChanges(params.versionId, access, comments));
    }

    case "publish":
      throw badRequest("Use the publish endpoint, which needs publication settings.", "use_publish");
  }
});
