import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { assignLeadTo } from "@/lib/crm-assign";
import { serializeLead } from "@/lib/crm-leads";

export const dynamic = "force-dynamic";

const AssignSchema = z.object({
  assignedToId: z.string().nullable(),
});

// POST /api/crm/leads/[id]/assign — assign / reassign (admin only)
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canAssign) throw forbidden();

  const body = await req.json().catch(() => null);
  const { assignedToId } = AssignSchema.parse(body);

  const updated = await assignLeadTo(params.id, assignedToId || null, userId);
  return NextResponse.json({ lead: serializeLead(updated) });
});
