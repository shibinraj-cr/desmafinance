import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * POST /api/finance/approvals/[id]/dismiss
 *
 * Submitter walks away from a rejected PendingApproval — hard-deletes
 * the row so it stops counting toward their rejected-queue badge. The
 * audit log retains the trail.
 *
 * Permissions: only the original submitter, and only on rejected items.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const existing = await prisma.pendingApproval.findUnique({
    where: { id: params.id },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.submittedById !== userId) {
    return NextResponse.json({ error: "forbidden_not_submitter" }, { status: 403 });
  }
  if (existing.status !== "rejected") {
    return NextResponse.json({ error: "not_rejected" }, { status: 409 });
  }

  await prisma.pendingApproval.delete({ where: { id: params.id } });
  await recordAudit({
    entityType: "PendingApproval",
    entityId: params.id,
    action: "DELETE",
    userId,
    changes: {
      kind: "dismiss_rejected",
      pendingKind: existing.kind,
      targetTxId: existing.targetTxId,
      reviewNote: existing.reviewNote,
    },
  });

  return NextResponse.json({ ok: true });
}
