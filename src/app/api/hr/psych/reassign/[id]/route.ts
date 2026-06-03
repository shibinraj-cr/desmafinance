import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { siteBaseUrl } from "@/lib/site-url";
import {
  generateRawToken,
  generateSalt,
  hashToken,
  DEFAULT_TTL_HOURS,
} from "@/lib/psych-tokens";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const old = await prisma.psychAssignment.findUnique({ where: { id: params.id } });
  if (!old) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const raw = generateRawToken();
  const salt = generateSalt();
  const tokenHash = hashToken(raw, salt);
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_HOURS * 3600_000);

  const fresh = await prisma.$transaction(async (tx) => {
    await tx.psychAssignment.update({
      where: { id: old.id },
      data: { status: "INVALIDATED" },
    });
    return tx.psychAssignment.create({
      data: {
        employeeId: old.employeeId,
        testId: old.testId,
        tokenHash,
        tokenSalt: salt,
        status: "ASSIGNED",
        expiresAt,
        assignedById: userId ?? undefined,
      },
    });
  });

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? undefined,
      eventType: "PSYCH_REASSIGN",
      entityType: "PsychAssignment",
      entityId: fresh.id,
      metadata: { previousAssignmentId: old.id, employeeId: old.employeeId, testId: old.testId },
    },
  });

  const url = `${siteBaseUrl(req)}/psych/test/${raw}`;
  return NextResponse.json({ assignmentId: fresh.id, url, expiresAt });
}
