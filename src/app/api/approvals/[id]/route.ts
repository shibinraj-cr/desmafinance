import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { approvePending, rejectPending } from "@/lib/approval";

const ActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 400 });
  }
  const { action, note } = parsed.data;
  const reviewerId = session.user.id;
  const reviewerRole = session.user.role ?? "executive";

  const result =
    action === "approve"
      ? await approvePending({ pendingId: params.id, reviewerId, reviewerRole, note })
      : await rejectPending({ pendingId: params.id, reviewerId, reviewerRole, note });

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
