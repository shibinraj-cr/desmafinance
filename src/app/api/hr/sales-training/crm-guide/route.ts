import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { createCrmGuideModule, loadCrmGuideFacts } from "@/lib/crm-guide-data";

/** Create the CRM guide's knowledge-check module (draft). Idempotent. */
export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await createCrmGuideModule(userId ?? null, await loadCrmGuideFacts());
  return NextResponse.json({ ok: true });
}
