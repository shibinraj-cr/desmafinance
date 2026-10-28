import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, badRequest, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getCrmAccess } from "@/lib/crm-rbac";
import { extendFollowUp, runLifecycleSweep, saveLifecycleConfig } from "@/lib/crm-lifecycle";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The lifecycle caps are a Marketing Admin decision: who may move leads between
// consultants and the central pool in bulk (admins + Lead Pulse supervisors).
async function requireLifecycleAccess(): Promise<string> {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getCrmAccess(userId, perms);
  if (!access.canBulkStatus) throw forbidden();
  return userId;
}

// GET /api/crm/lifecycle?asIfEnabled=1 — dry run: what would move now, plus the
// Follow-Up review list. `asIfEnabled` previews both caps switched on.
export const GET = withApiHandler(async (req: Request) => {
  await requireLifecycleAccess();
  const asIfEnabled = new URL(req.url).searchParams.get("asIfEnabled") === "1";
  const result = await runLifecycleSweep({ dryRun: true, previewAsIfEnabled: asIfEnabled });
  return NextResponse.json(result);
});

const PostSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), followUpEnabled: z.boolean(), remarketingEnabled: z.boolean() }),
  z.object({ action: z.literal("run") }),
  z.object({ action: z.literal("extend"), leadId: z.string().min(1), reason: z.string().trim().min(3).max(300) }),
]);

// POST /api/crm/lifecycle — switch the caps, run the sweep now, or extend one
// Follow-Up lead by 30 days (with a reason, recorded on its timeline).
export const POST = withApiHandler(async (req: Request) => {
  const userId = await requireLifecycleAccess();
  const body = PostSchema.parse(await req.json().catch(() => null));

  if (body.action === "save") {
    const config = await saveLifecycleConfig(body, userId);
    return NextResponse.json({ config });
  }
  if (body.action === "run") {
    const { preview: _p, review: _r, ...summary } = await runLifecycleSweep({ actorId: userId });
    return NextResponse.json(summary);
  }
  try {
    const until = await extendFollowUp({ leadId: body.leadId, actorId: userId, reason: body.reason });
    return NextResponse.json({ until: until.toISOString() });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m === "not_found") throw notFound();
    if (m === "not_in_follow_up") throw badRequest("Only a lead in Follow-Up can be extended.", "not_in_follow_up");
    throw e;
  }
});
