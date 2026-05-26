import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canApproveHr } from "@/lib/hr-rbac";

/**
 * Trigger today's birthday wishes. Marks each match in
 * HrBirthdayWish so re-runs are idempotent. We do NOT integrate with
 * an actual email/whatsapp provider in this version — the wish is
 * dropped into HrNotification so the recipient sees it on their
 * dashboard, and the send log is preserved for audit.
 */
export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!canApproveHr(perms)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const settings = await prisma.hrBirthdaySettings.findFirst({ where: { singleton: true } });
  if (!settings || !settings.autoWishEnabled || settings.channel === "disabled") {
    return NextResponse.json(
      { error: "auto wishes are disabled — enable them under Birthday Settings." },
      { status: 400 },
    );
  }
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();

  const todays = await prisma.employee.findMany({
    where: { active: true, dob: { not: null } },
    select: { id: true, name: true, dob: true, departments: { include: { department: true }, where: { isPrimary: true } } },
  });
  const matches = todays.filter((e) => {
    const d = e.dob as Date;
    return d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
  });

  let sent = 0;
  let skipped = 0;
  for (const e of matches) {
    const dept = e.departments[0]?.department.name ?? "";
    const body = settings.template
      .replaceAll("{{name}}", e.name)
      .replaceAll("{{dept}}", dept);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.hrBirthdayWish.create({
          data: {
            employeeId: e.id,
            year,
            channel: settings.channel,
            status: "sent",
            payload: { template: settings.template, body },
          },
        });
        const note = await tx.hrNotification.create({
          data: {
            title: "Happy Birthday!",
            body,
            kind: "birthday",
            requiresAck: false,
            createdById: userId ?? null,
          },
        });
        await tx.hrNotificationReceipt.create({
          data: { notificationId: note.id, employeeId: e.id },
        });
      });
      sent++;
    } catch {
      skipped++;
    }
  }
  await prisma.hrAuditLog.create({
    data: {
      actorUserId: userId ?? null,
      eventType: "birthday_wishes_sent",
      entityType: "HrBirthdayWish",
      metadata: { sent, skipped, date: today.toISOString().slice(0, 10) },
    },
  });
  return NextResponse.json({ sent, skipped });
}
