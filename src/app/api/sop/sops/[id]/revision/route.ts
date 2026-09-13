import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { requireSopAccess } from "@/lib/sop/access";
import { RevisionSchema } from "@/lib/sop/schemas";
import { createRevision } from "@/lib/sop/workflow";

export const dynamic = "force-dynamic";

/**
 * POST /api/sop/sops/[id]/revision — start the next version.
 *
 * Authorisation, the "one revision at a time" rule and the deep copy all live
 * in `createRevision`; this route is the HTTP shell around it.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireSopAccess();
  const d = RevisionSchema.parse(await req.json().catch(() => ({})));
  const result = await createRevision(params.id, access, {
    bump: d.bump,
    changeSummary: d.changeSummary ?? null,
  });
  return NextResponse.json(result, { status: 201 });
});
