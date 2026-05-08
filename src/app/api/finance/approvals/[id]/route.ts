import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approvePending, rejectPending } from "@/lib/approval";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

const ActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { action, note } = parsed.data;

  const result =
    action === "approve"
      ? await approvePending({
          pendingId: params.id,
          reviewerId: userId,
          reviewerPerms: perms,
          note,
        })
      : await rejectPending({
          pendingId: params.id,
          reviewerId: userId,
          reviewerPerms: perms,
          note,
        });

  if ("error" in result) {
    const code =
      result.error === "forbidden"
        ? 403
        : result.error === "not_found" || result.error === "target_gone"
          ? 404
          : 409;
    return NextResponse.json({ error: result.error }, { status: code });
  }
  return NextResponse.json(result);
}
