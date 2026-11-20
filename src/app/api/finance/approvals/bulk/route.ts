import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approvePending, rejectPending } from "@/lib/approval";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApprove, canSeePage } from "@/lib/rbac";

export const dynamic = "force-dynamic";
// Rows are posted one at a time, each in its own DB transaction, so a big
// batch needs more than the platform default. BATCH_BUDGET_MS stops starting
// new rows well before this, so the reply always arrives.
export const maxDuration = 300;

const PAGE = "/finance/approvals";
/** Stop starting new rows after this long; the rest come back "not_reached". */
const BATCH_BUDGET_MS = 240_000;

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
  const started = Date.now();
  let auth: Awaited<ReturnType<typeof getCurrentUserAndPermissions>>;
  try {
    auth = await getCurrentUserAndPermissions();
  } catch (err) {
    // The user lookup is the first DB call; if the database is waking up or
    // unreachable, say so instead of a bare 500.
    console.error("[approvals/bulk] permission lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  }
  const { perms, userId } = auth;
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canSeePage(perms, PAGE) || !canApprove(perms)) {
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
    if (Date.now() - started > BATCH_BUDGET_MS) {
      errors.push({ id: item.id, error: "not_reached" });
      continue;
    }
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
