import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { submitDraftToPending } from "@/lib/approval";

export const dynamic = "force-dynamic";

const BulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

/**
 * POST /api/finance/drafts/submit-bulk
 *
 * Promote many drafts to PendingApproval rows. Each item runs in its
 * own DB transaction inside this route's loop; one failure doesn't
 * abandon the batch.
 */
export async function POST(req: NextRequest) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = BulkSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "validation_failed" }, { status: 400 });

  let processed = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const id of parsed.data.ids) {
    try {
      const result = await submitDraftToPending({ draftId: id, userId, perms });
      if ("error" in result && result.error) {
        errors.push({ id, error: String(result.error) });
      } else {
        processed += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[drafts/submit-bulk] item failed", { draftId: id, error: msg });
      errors.push({ id, error: `threw: ${msg.slice(0, 120)}` });
    }
  }
  return NextResponse.json({ ok: true, processed, errors });
}
