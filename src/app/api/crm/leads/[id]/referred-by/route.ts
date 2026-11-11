import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { forbidden, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { setReferredBy } from "@/lib/crm-referral-reward";

export const dynamic = "force-dynamic";

const Schema = z.object({ referredByLeadId: z.string().min(1).nullable() });

// PATCH /api/crm/leads/[id]/referred-by — set, change or clear who referred a
// lead after it was created. Money hangs off it (the referral reward), so only
// whoever hands out leads may do it, and never once the reward is paid.
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canAssign) throw forbidden();

  const { referredByLeadId } = Schema.parse(await req.json().catch(() => null));
  await setReferredBy(params.id, referredByLeadId, userId);
  return NextResponse.json({ ok: true });
});
