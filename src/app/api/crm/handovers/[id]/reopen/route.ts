import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getHandoverAccess, reopenHandover } from "@/lib/crm-handover-data";

export const dynamic = "force-dynamic";

/** The Marketing Admin sends a rejected handover back to the BDE, with a fresh deadline. */
export const POST = withApiHandler(async (_req: Request, ctx: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getHandoverAccess(userId, perms);
  await reopenHandover({ id: ctx.params.id, access, actorId: userId });
  return NextResponse.json({ ok: true });
});
