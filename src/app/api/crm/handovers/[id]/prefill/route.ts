import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { handoverPrefill } from "@/lib/crm-handover-data";

export const dynamic = "force-dynamic";

/**
 * What the app's New lead screen opens with for a handover's "Create lead" —
 * the same pre-fill the web form gets. Only the BDE's own, still-open handover.
 */
export const GET = withApiHandler(async (_req: Request, ctx: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const prefill = await handoverPrefill(ctx.params.id, userId);
  if (!prefill) throw notFound("This handover isn't yours, or it's no longer open.");
  return NextResponse.json({ prefill });
});
