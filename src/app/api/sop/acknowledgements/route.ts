import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApiHandler } from "@/lib/api";
import { badRequest, forbidden, notFound } from "@/lib/http-error";
import { requireSopAccess } from "@/lib/sop/access";
import { AcknowledgeSchema } from "@/lib/sop/schemas";
import { myAcknowledgements, acknowledgementRegister } from "@/lib/sop/queries";
import { markViewed } from "@/lib/sop/acknowledge";
import { recordSopAudit, requestMeta } from "@/lib/sop/audit";

export const dynamic = "force-dynamic";

/**
 * GET — the signed-in employee's own acknowledgements by default, or one
 * version's full register (`?version=`) for anyone entitled to the SOP.
 */
export const GET = withApiHandler(async (req: Request) => {
  const access = await requireSopAccess();
  const versionId = new URL(req.url).searchParams.get("version");

  if (!versionId) return NextResponse.json({ rows: await myAcknowledgements(access) });

  const version = await prisma.sopVersion.findUnique({
    where: { id: versionId },
    select: { id: true, sopId: true, ownerEmployeeId: true },
  });
  if (!version) throw notFound("SOP version not found.");
  // The register names individuals and their compliance state, so it is a
  // governance surface: SOP admins and the process owner, not every reader.
  const isOwner = !!access.employeeId && access.employeeId === version.ownerEmployeeId;
  if (!access.isSopAdmin && !isOwner) throw forbidden();

  return NextResponse.json(await acknowledgementRegister(versionId));
});

/**
 * POST — "I have read & understood", or the softer "I opened it".
 *
 * The row must already exist: acknowledgement rows are materialised at publish
 * time from the audience, so a POST for a version nobody assigned you is a 404,
 * not a new assignment you granted yourself.
 *
 * An existing acknowledgement is never overwritten — the first confirmation is
 * the compliance record, and re-posting cannot move its timestamp.
 */
export const POST = withApiHandler(async (req: Request) => {
  const access = await requireSopAccess();
  if (!access.employeeId) {
    throw badRequest(
      "Your login is not linked to an employee record, so acknowledgements cannot be recorded against it.",
      "no_employee",
    );
  }

  const d = AcknowledgeSchema.parse(await req.json().catch(() => null));
  const ack = await prisma.sopAcknowledgement.findUnique({
    where: { versionId_employeeId: { versionId: d.versionId, employeeId: access.employeeId } },
    include: { version: { select: { versionLabel: true } } },
  });
  if (!ack) throw notFound("You have not been assigned this SOP.");

  if (d.action === "view") {
    await markViewed(ack.id, access.userId);
    return NextResponse.json({ ok: true, state: "viewed" });
  }

  if (ack.acknowledgedAt) {
    return NextResponse.json({ ok: true, state: "acknowledged", alreadyAcknowledged: true });
  }

  const now = new Date();
  const meta = requestMeta();
  await prisma.sopAcknowledgement.update({
    where: { id: ack.id },
    data: {
      acknowledgedAt: now,
      // Opening the confirmation dialog implies having viewed it; backfill the
      // view timestamp rather than leaving a row that was acknowledged but
      // never "viewed".
      viewedAt: ack.viewedAt ?? now,
      status: "acknowledged",
      userId: access.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
  });

  await recordSopAudit({
    sopId: ack.sopId,
    versionId: ack.versionId,
    versionLabel: ack.version.versionLabel,
    userId: access.userId,
    action: "ACKNOWLEDGED",
    newValue: "acknowledged",
    metadata: { employeeId: access.employeeId },
  });

  return NextResponse.json({ ok: true, state: "acknowledged" });
});
