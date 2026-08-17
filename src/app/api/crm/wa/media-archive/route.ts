import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { archivePendingMedia } from "@/lib/wa/media-archive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const Schema = z.object({ limit: z.number().int().min(1).max(1000).default(400) });

/**
 * POST /api/crm/wa/media-archive — run the backfill now.
 *
 * The nightly cron keeps up with new messages on its own; this exists because
 * the BACKLOG is on a deadline the cron does not know about. Imported Wabis
 * attachments live on Wabis's storage, so every one of them has to be copied
 * before that subscription ends — and "wait for tonight" is the wrong answer
 * when somebody is about to press cancel.
 */
export const POST = withApiHandler(async (req: Request) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canManageSettings) throw forbidden();

  const { limit } = Schema.parse(await req.json().catch(() => ({})));
  return NextResponse.json(await archivePendingMedia({ limit }));
});
