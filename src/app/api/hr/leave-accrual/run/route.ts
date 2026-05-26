import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { runMonthlyAccrual } from "@/lib/hr-leave-accrual";

const Schema = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
});

/**
 * Trigger the monthly leave accrual job for a given period. Idempotent
 * — running again for the same period skips already-credited
 * employees.
 *
 * Can be called by HR Manager from the UI, or by an external cron
 * (with admin creds) at the start of each month.
 */
export async function POST(req: Request) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  const result = await runMonthlyAccrual(parsed.data.periodKey);
  return NextResponse.json(result);
}
