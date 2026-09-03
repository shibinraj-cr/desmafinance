import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { syncWaTemplatesFromMeta } from "@/lib/wa/templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST — reconcile every template against Meta's catalogue.
 *
 * The status webhook is faster but conditional: it only fires while the app is
 * subscribed to `message_template_status_update`, a field on the WABA
 * subscription that the conversation mirror never needed. Until that is
 * selected — and as a backstop after it is — this is how an approval reaches the
 * CRM. Manual rather than a cron because Vercel's Hobby plan runs crons daily,
 * which is not a useful cadence for "is my template approved yet?".
 */
export const POST = withApiHandler(async () => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  if (!(await getCrmAccess(userId, perms)).canManageTemplates) throw forbidden();

  const summary = await syncWaTemplatesFromMeta();
  return NextResponse.json(summary, { status: summary.ok ? 200 : 422 });
});
