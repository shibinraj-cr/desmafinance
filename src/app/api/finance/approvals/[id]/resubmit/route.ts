import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import type { TxProposed } from "@/lib/approval";
import { RawTxFieldsSchema, buildValidatedProposed } from "@/lib/finance-tx-validation";

export const dynamic = "force-dynamic";

// Resubmission of a rejected approval lives on the Approvals page.
const PAGE = "/finance/approvals";

const BodySchema = z.object({
  // For create/update kinds — optional, but required for resubmission of
  // create/update. Delete kind has no editable fields. The payload is validated
  // by buildValidatedProposed (below), the SAME gate as normal create/update —
  // so a rejected row can't be pushed back with a zero amount, an unknown
  // category/sub-item, or an invalid type / payment mode / flow.
  proposed: RawTxFieldsSchema.optional(),
  // Note attached to the resubmission so reviewers see why it's back.
  note: z.string().max(500).optional(),
});

/**
 * POST /api/finance/approvals/[id]/resubmit
 *
 * Submitter takes a previously-rejected PendingApproval, patches the
 * proposed payload, and pushes it back into the pending queue.
 *
 * Permissions: only the original submitter can resubmit (no role gate
 * beyond ownership).
 *
 * Effect:
 *   - status: rejected → pending
 *   - proposed: replaced (for create/update kinds)
 *   - reviewedBy / reviewedAt / reviewNote: cleared (so the next
 *     reviewer sees a fresh request). The previous reviewer + note are
 *     captured in the audit log.
 *   - The resubmission note is stored in reviewNote prefixed
 *     `[resubmitted]` so it's visible on the next round.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canSeePage(perms, PAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
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

  const previousReviewNote = existing.reviewNote;
  const previousReviewerId = existing.reviewedById;
  const note = parsed.data.note?.trim() ?? "";
  // Run the SAME validation as normal create/update: date, derived month,
  // type enum, category/sub-item master, payment mode enum, positive amount
  // (rejects zero), flow enum-or-derived, counterparty, and EXP/DOM. Delete
  // kind has no editable fields, so there's nothing to validate for it.
  let proposed: TxProposed | undefined;
  if (parsed.data.proposed) {
    const built = await buildValidatedProposed(parsed.data.proposed);
    if ("error" in built) {
      return NextResponse.json({ error: built.error }, { status: 400 });
    }
    proposed = built.proposed;
  }

  // Build new reviewNote so the queue shows the resubmission context.
  const stamp = `[resubmitted${note ? `: ${note}` : ""}]`;
  const newReviewNote = previousReviewNote
    ? `${stamp} (previously: ${previousReviewNote})`
    : stamp;

  const updated = await prisma.pendingApproval.update({
    where: { id: params.id },
    data: {
      status: "pending",
      reviewedById: null,
      reviewedAt: null,
      reviewNote: newReviewNote,
      // Only swap proposed when the caller supplies one (create/update kinds).
      ...(proposed
        ? { proposed: proposed as unknown as object }
        : {}),
    },
  });

  await recordAudit({
    entityType: "PendingApproval",
    entityId: updated.id,
    action:
      existing.kind === "create"
        ? "SUBMIT_CREATE"
        : existing.kind === "update"
          ? "SUBMIT_UPDATE"
          : "SUBMIT_DELETE",
    userId,
    changes: {
      kind: "resubmit",
      previousStatus: "rejected",
      previousReviewerId,
      previousReviewNote,
      note,
      proposed,
    },
  });

  return NextResponse.json({ ok: true, pending: updated });
}
