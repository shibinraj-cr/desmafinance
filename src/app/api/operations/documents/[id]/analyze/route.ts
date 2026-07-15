import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { unauthorized, forbidden, notFound, badRequest } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getOpsAccess, canEditProject } from "@/lib/ops-rbac";
import { serializeDocument } from "@/lib/ops-queries";
import { isAiEnabled } from "@/lib/anthropic";
import { analyzeProofDocument, isAnalyzableMime, OPS_DOC_AI_MODEL, type ProofAnalysis } from "@/lib/ops-doc-ai";
import { recordOpsActivity } from "@/lib/ops-activity";

export const dynamic = "force-dynamic";
// Claude vision/document calls can take several seconds.
export const maxDuration = 60;

type Ctx = { params: { id: string } };

const docInclude = { uploadedBy: { select: { username: true } } };

// POST /api/operations/documents/[id]/analyze — run (or re-run) Claude's
// proof analysis on a document and persist the verdict. Called automatically by
// the client after upload, and by the "Re-analyse" button. Synchronous.
export const POST = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const access = getOpsAccess(userId, perms);

  const doc = await prisma.opsDocument.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      fileName: true,
      fileUrl: true,
      mimeType: true,
      task: {
        select: {
          name: true,
          description: true,
          projectId: true,
          project: {
            select: {
              assignedToId: true,
              party: { select: { name: true } },
              service: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!doc) throw notFound();
  if (!canEditProject(access, doc.task.project, userId)) throw forbidden();

  if (!isAnalyzableMime(doc.mimeType)) throw badRequest("This file type can't be analysed.", "not_analyzable");

  if (!isAiEnabled()) {
    const updated = await prisma.opsDocument.update({
      where: { id: doc.id },
      data: { aiStatus: "skipped" },
      include: docInclude,
    });
    return NextResponse.json({ document: serializeDocument(updated), aiEnabled: false });
  }

  await prisma.opsDocument.update({ where: { id: doc.id }, data: { aiStatus: "processing" } });

  let analysis: ProofAnalysis;
  try {
    const resp = await fetch(doc.fileUrl);
    if (!resp.ok) throw new Error(`fetch_${resp.status}`);
    const base64 = Buffer.from(await resp.arrayBuffer()).toString("base64");
    analysis = await analyzeProofDocument({
      mimeType: doc.mimeType as string,
      base64,
      fileName: doc.fileName,
      stepName: doc.task.name,
      stepDescription: doc.task.description,
      candidateName: doc.task.project.party.name,
      serviceName: doc.task.project.service.name,
    });
  } catch (e) {
    console.error("[ops-doc-ai] analysis failed:", e);
    const failed = await prisma.opsDocument.update({
      where: { id: doc.id },
      data: { aiStatus: "failed", aiAnalyzedAt: new Date() },
      include: docInclude,
    });
    return NextResponse.json({ document: serializeDocument(failed), error: "analysis_failed" }, { status: 502 });
  }

  const updated = await prisma.opsDocument.update({
    where: { id: doc.id },
    data: {
      aiStatus: "done",
      aiVerdict: analysis.verdict,
      aiSummary: analysis.summary,
      aiConcerns: analysis.concerns,
      aiFacts: analysis.facts,
      aiModel: OPS_DOC_AI_MODEL,
      aiAnalyzedAt: new Date(),
    },
    include: docInclude,
  });

  await recordOpsActivity({
    projectId: doc.task.projectId,
    taskId: undefined,
    actorId: userId,
    type: "DOCUMENT_ANALYZED",
    summary: `Proof "${doc.fileName}" analysed — ${analysis.verdict}`,
    metadata: { documentId: doc.id, verdict: analysis.verdict },
  });

  return NextResponse.json({ document: serializeDocument(updated) });
});
