import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { todayIst } from "@/lib/lead-pulse-dates";
import { applyOwnerUpdate } from "@/lib/meeting-notes";
import { OwnerActionUpdateSchema } from "@/lib/meeting-notes-model";

export const dynamic = "force-dynamic";

/**
 * An action item's owner updates it — from the due-date reminder pop-up or
 * from My Workspace → Meetings. Not admin-gated: ownership is the check, done
 * in applyOwnerUpdate (admins may update any item).
 */
export const PATCH = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  const body = OwnerActionUpdateSchema.parse(await req.json());
  await applyOwnerUpdate(params.id, { id: userId, isAdmin: !!perms?.isAdmin }, body, todayIst());
  return NextResponse.json({ ok: true });
});
