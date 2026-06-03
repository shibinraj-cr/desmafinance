import { NextResponse } from "next/server";
import { z } from "zod";
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

const Body = z.object({
  employeeId: z.string().min(1),
  testId: z.string().min(1),
  ttlHours: z.number().int().min(1).max(720).optional(),
});

export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success)
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });

  const { employeeId, testId } = parsed.data;
  const ttlHours = parsed.data.ttlHours ?? DEFAULT_TTL_HOURS;

  const [emp, test, existingActive] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId } }),
    prisma.psychTest.findUnique({ where: { id: testId } }),
    prisma.psychAssignment.findFirst({
      where: {
        employeeId,
        testId,
        status: { in: ["ASSIGNED", "IN_PROGRESS"] },
      },
    }),
  ]);
  if (!emp) return NextResponse.json({ error: "employee_not_found" }, { status: 404 });
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (existingActive)
    return NextResponse.json(
      { error: "active_assignment_exists", existingId: existingActive.id },
      { status: 409 },
    );

  const raw = generateRawToken();
  const salt = generateSalt();
  const tokenHash = hashToken(raw, salt);
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);

  const assignment = await prisma.psychAssignment.create({
    data: {
      employeeId,
      testId,
      tokenHash,
      tokenSalt: salt,
      status: "ASSIGNED",
      expiresAt,
      assignedById: userId ?? undefined,
    },
  });

  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? undefined,
      eventType: "PSYCH_ASSIGN",
      entityType: "PsychAssignment",
      entityId: assignment.id,
      metadata: { employeeId, testId, expiresAt, ttlHours },
    },
  });

  const url = `${siteBaseUrl(req)}/psych/test/${raw}`;
  return NextResponse.json({ assignmentId: assignment.id, url, expiresAt });
}
