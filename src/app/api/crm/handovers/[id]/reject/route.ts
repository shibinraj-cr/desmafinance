import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { HANDOVER_REJECT_REASON_CODES } from "@/lib/crm-handover";
import { getHandoverAccess, rejectHandover } from "@/lib/crm-handover-data";

export const dynamic = "force-dynamic";

const RejectSchema = z.object({
  reason: z.enum(HANDOVER_REJECT_REASON_CODES),
  note: z.string().trim().max(1000).optional().nullable(),
});

/** The assigned BDE rejects an open handover (the Marketing Admin may cancel one). */
export const POST = withApiHandler(async (req: Request, ctx: { params: { id: string } }) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = await getHandoverAccess(userId, perms);
  const input = RejectSchema.parse(await req.json().catch(() => null));
  await rejectHandover({ id: ctx.params.id, access, actorId: userId, ...input });
  return NextResponse.json({ ok: true });
});
