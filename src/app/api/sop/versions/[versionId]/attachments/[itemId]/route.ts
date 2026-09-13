import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { notFound } from "@/lib/http-error";
import { deleteProof, isBlobConfigured } from "@/lib/ops-blob";
import { requireSopAccess } from "@/lib/sop/access";
import { assertVersionEditable } from "@/lib/sop/workflow";
import { recordSopAudit } from "@/lib/sop/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { versionId: string; itemId: string } };

/**
 * DELETE — detach a document.
 *
 * The stored blob is removed best-effort: a failed blob delete must not leave
 * the SOP showing an attachment the user just removed, and an orphaned blob is
 * a storage cost, not a correctness problem.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const version = await assertVersionEditable(params.versionId, access);
  const existing = await prisma.sopAttachment.findFirst({
    where: { id: params.itemId, versionId: version.id },
  });
  if (!existing) throw notFound("Attachment not found.");

  await prisma.sopAttachment.delete({ where: { id: existing.id } });

  if (existing.fileUrl && isBlobConfigured()) {
    // A revision COPIES attachment rows, so the same blob URL can be referenced
    // by another version. Only delete the stored file when nothing else points
    // at it — otherwise removing a stale attachment from a draft would break
    // the published SOP it was copied from.
    const stillReferenced = await prisma.sopAttachment.count({
      where: { fileUrl: existing.fileUrl },
    });
    if (stillReferenced === 0) {
      await deleteProof(existing.fileUrl).catch((e) =>
        console.error("[sop] failed to delete attachment blob:", e),
      );
    }
  }

  await recordSopAudit({
    sopId: version.sopId,
    versionId: version.id,
    versionLabel: version.versionLabel,
    userId: access.userId,
    action: "ATTACHMENT_DELETED",
    oldValue: existing.title,
  });

  return NextResponse.json({ ok: true });
});
