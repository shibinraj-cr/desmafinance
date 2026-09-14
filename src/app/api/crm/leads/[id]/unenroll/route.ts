import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { previewUnenroll, unenrollLead } from "@/lib/crm-unenroll";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

// ── GET — read-only plan for the confirm dialog ──────────────────────────────
export const GET = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canUnenroll) throw forbidden();

  return NextResponse.json({ plan: await previewUnenroll(params.id) });
});

// ── POST — reverse the enrollment and move the lead to `toStatusId` ─────────
const Schema = z.object({
  toStatusId: z.string().min(1),
  reason: z.string().trim().max(500).optional().nullable(),
  /** Set once the user has seen the plan's warnings in the dialog. */
  acknowledge: z.boolean().optional(),
});

export const POST = withApiHandler(async (req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canUnenroll) throw forbidden();

  const d = Schema.parse(await req.json().catch(() => null));
  const result = await unenrollLead({
    leadId: params.id,
    toStatusId: d.toStatusId,
    reason: d.reason ?? null,
    acknowledge: d.acknowledge ?? false,
    actorId: userId,
  });
  return NextResponse.json(result);
});
