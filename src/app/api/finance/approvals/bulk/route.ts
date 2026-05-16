import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approvePending, rejectPending } from "@/lib/approval";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApprove } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const ItemSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional(),
});

const BulkSchema = z.object({
  items: z.array(ItemSchema).min(1).max(500),
});

/**
 * POST /api/finance/approvals/bulk
 *
 * Apply approve / reject to many PendingApproval rows in one round-trip.
 * Per-item failures don't abort the batch; the response surfaces both
 * the processed count and per-id error codes so the client can retry
 * the failures without losing the rest of the work.
 */
export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canApprove(perms)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }

  let processed = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const item of parsed.data.items) {
    const result =
      item.action === "approve"
        ? await approvePending({
            pendingId: item.id,
            reviewerId: userId,
            reviewerPerms: perms,
            note: item.note,
          })
        : await rejectPending({
            pendingId: item.id,
            reviewerId: userId,
            reviewerPerms: perms,
            note: item.note,
          });
    if ("error" in result && result.error) {
      errors.push({ id: item.id, error: String(result.error) });
    } else {
      processed += 1;
    }
  }
  return NextResponse.json({ ok: true, processed, errors });
}
