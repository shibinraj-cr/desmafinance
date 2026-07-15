import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject } from "@/lib/ops-rbac";
import { deleteProof } from "@/lib/ops-blob";
import { recordOpsActivity } from "@/lib/ops-activity";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

// DELETE /api/operations/documents/[id] — remove a proof file (blob + row).
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);

  const doc = await prisma.opsDocument.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      fileName: true,
      fileUrl: true,
      taskId: true,
      task: { select: { name: true, projectId: true, project: { select: { assignedToId: true } } } },
    },
  });
  if (!doc) throw notFound();
  if (!canEditProject(access, doc.task.project, userId)) throw forbidden();

  // Best-effort blob delete — never block the row removal on a storage hiccup.
  await deleteProof(doc.fileUrl).catch((e) => console.error("[ops-blob] delete failed:", e));
  await prisma.opsDocument.delete({ where: { id: doc.id } });

  await recordOpsActivity({
    projectId: doc.task.projectId,
    taskId: doc.taskId,
    actorId: userId,
    type: "DOCUMENT_REMOVED",
    summary: `Proof removed from "${doc.task.name}": ${doc.fileName}`,
    metadata: { documentId: doc.id },
  });

  return NextResponse.json({ ok: true });
});
