import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { requireHiring } from "@/lib/hiring/access";
import { recordHiringAudit } from "@/lib/hiring/audit";
import { closeJob } from "@/lib/hiring/jobs";

export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().trim().min(1).max(300) });

// POST /api/hiring/jobs/[id]/close
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireHiring("job:write");
  const { reason } = schema.parse(await req.json());
  const job = await closeJob(params.id, reason);

  await recordHiringAudit({
    actorId: access.userId,
    action: "job.close",
    entityType: "HiringJob",
    entityId: job.id,
    after: { closeReason: job.closeReason },
  });

  return NextResponse.json({ ok: true });
});
