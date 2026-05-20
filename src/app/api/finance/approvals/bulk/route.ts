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
    try {
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
    } catch (err) {
      // Without this catch a single Prisma throw (FK violation, JSON
      // shape drift, etc.) abandons the rest of the batch and the
      // client just sees a generic 500. Log the stack so Vercel keeps
      // a record, then surface a short code to the client.
      const msg = err instanceof Error ? err.message : String(err);
      const code = /Foreign key|constraint/i.test(msg)
        ? "constraint_violation"
        : `threw: ${msg.slice(0, 120)}`;
      console.error("[approvals/bulk] item failed", {
        pendingId: item.id,
        action: item.action,
        error: msg,
        stack: err instanceof Error ? err.stack : undefined,
      });
      errors.push({ id: item.id, error: code });
    }
  }
  return NextResponse.json({ ok: true, processed, errors });
}
