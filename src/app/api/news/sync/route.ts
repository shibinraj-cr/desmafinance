import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { syncAllSources } from "@/lib/news/sync";

export const dynamic = "force-dynamic";
// Pulling every source serially can outrun the default request budget.
export const maxDuration = 300;

const Schema = z.object({ sourceId: z.string().min(1).optional() });

/**
 * POST /api/news/sync — pull sources now instead of waiting for the daily cron.
 * Admin only. With `{ sourceId }` it re-pulls just that link, which is how the
 * Sources page offers a "Fetch now" per row.
 */
export async function POST(req: Request) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!perms.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parsed = Schema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }

  const summary = await syncAllSources({ sourceId: parsed.data.sourceId });
  return NextResponse.json({ ok: true, ...summary });
}
