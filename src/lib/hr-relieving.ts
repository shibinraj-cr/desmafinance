import { prisma } from "@/lib/prisma";
import { istToday } from "@/lib/dates";

/**
 * Relieving (exit) handling. HR sets `Employee.relievingDate` — the leaver's
 * last working day — on the employee master. From then on:
 *   - payroll pays only up to it (daysAfterRelieving in hr-salary-engine.ts),
 *   - the biometric ingest ignores punches dated after it,
 *   - the leave ledger ignores attendance after it,
 *   - and once it has passed (in IST), the sweep below deactivates the
 *     employee and their login.
 *
 * Nothing is deleted: attendance already stored after the date stays as it was
 * but is never paid, so a mistyped date can be corrected without data loss.
 */

/** Today in IST as a date-only value (midnight UTC), comparable to @db.Date. */
export function istTodayDate(now: Date = new Date()): Date {
  const t = istToday(now);
  return new Date(Date.UTC(t.year, t.month - 1, t.day));
}

/**
 * Deactivate every still-active employee whose relieving date has passed, plus
 * their linked login (an inactive user cannot sign in, and every request
 * re-checks it — see permissions.ts). Pass `employeeId` to sweep just one.
 * Idempotent; runs on each biometric cron tick and on every employee save.
 */
export async function deactivateRelievedEmployees(opts: {
  employeeId?: string;
  actorUserId?: string | null;
  now?: Date;
} = {}): Promise<{ id: string; empCode: string; relievingDate: string }[]> {
  const today = istTodayDate(opts.now);
  const due = await prisma.employee.findMany({
    where: {
      ...(opts.employeeId ? { id: opts.employeeId } : {}),
      relievingDate: { lt: today },
      OR: [{ active: true }, { user: { isActive: true } }],
    },
    select: { id: true, empCode: true, relievingDate: true, userId: true },
  });

  for (const e of due) {
    await prisma.$transaction([
      prisma.employee.update({ where: { id: e.id }, data: { active: false } }),
      ...(e.userId
        ? [prisma.user.update({ where: { id: e.userId }, data: { isActive: false } })]
        : []),
      prisma.hrAuditLog.create({
        data: {
          actorUserId: opts.actorUserId ?? null,
          eventType: "employee_relieved",
          entityType: "Employee",
          entityId: e.id,
          metadata: {
            relievingDate: e.relievingDate!.toISOString().slice(0, 10),
            loginDisabled: !!e.userId,
          },
        },
      }),
    ]);
  }

  return due.map((e) => ({
    id: e.id,
    empCode: e.empCode,
    relievingDate: e.relievingDate!.toISOString().slice(0, 10),
  }));
}
