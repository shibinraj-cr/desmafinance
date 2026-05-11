import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const TxFieldsSchema = z.object({
  date: z.string().min(1),
  month: z.string().min(1),
  type: z.string().min(1),
  category: z.string().min(1),
  subItem: z.string().min(1),
  description: z.string().nullable().optional(),
  paymentMode: z.string().min(1),
  amount: z.number().nonnegative(),
  flow: z.string().min(1),
  partyId: z.string().nullable().optional(),
});

const BodySchema = z.object({
  // For create/update kinds — optional, but required for resubmission of
  // create/update. Delete kind has no editable fields.
  proposed: TxFieldsSchema.optional(),
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
  const proposed = parsed.data.proposed;

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
