import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { manualAdjustment } from "@/lib/hr-leave-accrual";

const Schema = z.object({
  employeeId: z.string().min(1),
  delta: z.number().refine((n) => n !== 0, "delta cannot be zero"),
  reason: z.string().min(1).max(500),
  leaveType: z.enum(["CL", "SL", "PL"]).optional(),
});

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    await manualAdjustment({ ...parsed.data, actorUserId: userId ?? null });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 400 });
  }
}
