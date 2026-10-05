import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";
import { notifyEmployees } from "@/lib/sales-training-db";

const Schema = z.object({
  employeeIds: z.array(z.string()).min(1).max(500),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

/** Enrol (or re-activate) employees in the Sales Consultant programme. */
export async function POST(req: Request) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick at least one employee." }, { status: 400 });
  const dueDate = parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null;

  const employees = await prisma.employee.findMany({
    where: { id: { in: parsed.data.employeeIds }, active: true },
    select: { id: true, salesTrainingLearner: { select: { active: true } } },
  });
  // Only people who weren't already active learners get the welcome notification.
  const newlyActive = employees.filter((e) => !e.salesTrainingLearner?.active).map((e) => e.id);

  await prisma.$transaction(
    employees.map((e) =>
      prisma.salesTrainingLearner.upsert({
        where: { employeeId: e.id },
        create: { employeeId: e.id, dueDate, enrolledById: userId },
        update: { active: true, ...(parsed.data.dueDate !== undefined ? { dueDate } : {}) },
      }),
    ),
  );
  await notifyEmployees(newlyActive, {
    title: "You're enrolled in Sales Consultant Training",
    body: dueDate
      ? `Watch each module's videos and pass its quiz by ${parsed.data.dueDate}.`
      : "Watch each module's videos and pass its quiz.",
    linkUrl: "/me/sales-training",
    createdById: userId,
  });
  return NextResponse.json({ enrolled: employees.length });
}
