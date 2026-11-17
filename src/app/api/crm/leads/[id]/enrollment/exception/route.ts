import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { forbidden, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { decideException } from "@/lib/crm-enrollment";

export const dynamic = "force-dynamic";

const Body = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(300).optional().nullable(),
});

// POST /api/crm/leads/[id]/enrollment/exception — the sales head approves or
// rejects a first payment under the minimum. The same people who may
// un-enroll or date an enrollment back (CrmAccess.canUnenroll).
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canUnenroll) throw forbidden("Only the sales head can decide a smaller first payment.");
  const d = Body.parse(await req.json().catch(() => null));
  return NextResponse.json(await decideException({ leadId: params.id, actorId: userId, approve: d.approve, note: d.note || null }));
});
