import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api";
import { forbidden, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { hasFullTeamPerformanceAccess } from "@/lib/team-performance-rbac";
import { ingestSchema, ingestScores, isValidIngestToken } from "@/lib/team-performance-ingest";

export const dynamic = "force-dynamic";

// POST /api/performance/whatsapp/ingest
// Daily WhatsApp scoring routine → upserts staff scores + unanswered queries.
// Auth: Bearer TEAM_PERF_INGEST_TOKEN (routine) or a signed-in Admin / HR Manager.
export const POST = withApiHandler(async (req: Request) => {
  if (!isValidIngestToken(req)) {
    const { userId, perms } = await getCurrentUserAndPermissions();
    if (!userId || !perms) throw unauthorized();
    if (!hasFullTeamPerformanceAccess(perms)) throw forbidden();
  }
  const payload = ingestSchema.parse(await req.json());
  const result = await ingestScores(payload);
  return NextResponse.json({ ok: true, ...result });
});
