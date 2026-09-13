import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { conflict, forbidden, notFound } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { loadSopDetail, versionHistory, auditTrail } from "@/lib/sop/queries";
import { canDeleteSop, canViewSop } from "@/lib/sop/rbac";
import { recordSopAudit } from "@/lib/sop/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: { id: string } };

/** GET /api/sop/sops/[id]?version=<id> — one SOP, with a version and history. */
export const GET = withApiHandler(async (req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const versionId = new URL(req.url).searchParams.get("version");

  const { sop, version } = await loadSopDetail(params.id, access, versionId);
  const [history, audit] = await Promise.all([
    versionHistory(params.id),
    // The audit trail is a governance surface, not general reading.
    access.isSopAdmin || access.employeeId === sop.ownerEmployeeId
      ? auditTrail(params.id)
      : Promise.resolve([]),
  ]);

  return NextResponse.json({ sop, version, history, audit });
});

/**
 * DELETE /api/sop/sops/[id] — soft delete.
 *
 * Only ever available before the first publish: once an SOP has been published,
 * the record is permanent and the way out is Archive (§20). The row is retained
 * with `deletedAt` set so the number is never reissued and the audit trail
 * keeps its subject.
 */
export const DELETE = withApiHandler(async (_req: Request, { params }: Ctx) => {
  const access = await requireSopAccess();
  const sop = await prisma.sop.findUnique({ where: { id: params.id } });
  if (!sop || sop.deletedAt) throw notFound("SOP not found.");
  if (!canViewSop(access, sop)) throw forbidden();
  if (!canDeleteSop(access, sop)) {
    throw sop.currentVersionId
      ? conflict("A published SOP cannot be deleted — archive it instead.", "published_sop")
      : forbidden();
  }

  await prisma.sop.update({
    where: { id: params.id },
    data: { deletedAt: new Date(), draftVersionId: null },
  });

  await recordSopAudit({
    sopId: params.id,
    userId: access.userId,
    action: "DELETED",
    oldValue: sop.status,
    metadata: { sopNumber: sop.sopNumber },
  });

  return NextResponse.json({ ok: true });
});
