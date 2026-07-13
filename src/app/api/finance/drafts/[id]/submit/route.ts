import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { submitDraftToPending } from "@/lib/approval";

export const dynamic = "force-dynamic";

const PAGE = "/finance/approvals";

/**
 * POST /api/finance/drafts/[id]/submit
 *
 * Promote one draft to a PendingApproval (or directly to a Transaction
 * if the user happens to have canApprove). The draft is consumed in
 * the same DB transaction.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeePage(perms, PAGE)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const result = await submitDraftToPending({ draftId: params.id, userId, perms });
  if ("error" in result && result.error) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 403 },
    );
  }
  if (result.applied) {
    return NextResponse.json({ applied: true, transactionId: result.transaction.id });
  }
  return NextResponse.json({ applied: false, pendingId: result.pending.id });
}
