import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { requireSopAccess } from "@/lib/sop/access";
import { loadSopDetail } from "@/lib/sop/queries";
import { markViewed } from "@/lib/sop/acknowledge";

export const dynamic = "force-dynamic";

/**
 * POST /api/sop/sops/[id]/view — record that someone opened the published SOP.
 *
 * Fired by the reading view, not by the editor: the library's "most viewed"
 * sort should reflect people USING an SOP, not its author saving a draft.
 * The authorisation check runs first, so the counter cannot be nudged by
 * someone who could not have read the document.
 */
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const access = await requireSopAccess();
  const versionId = new URL(req.url).searchParams.get("version");
  const { sop, version } = await loadSopDetail(params.id, access, versionId);

  await prisma.sop.update({ where: { id: sop.id }, data: { viewCount: { increment: 1 } } });

  // If this viewer owes an acknowledgement on this version, opening it counts
  // as having viewed it — the "Viewed" column of the compliance register.
  if (access.employeeId && version) {
    const ack = await prisma.sopAcknowledgement.findUnique({
      where: { versionId_employeeId: { versionId: version.id, employeeId: access.employeeId } },
      select: { id: true, viewedAt: true },
    });
    if (ack && !ack.viewedAt) await markViewed(ack.id, access.userId);
  }

  return NextResponse.json({ ok: true });
});
