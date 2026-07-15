import { prisma } from "@/lib/prisma";
import { employeeForUser } from "@/lib/hr-me";

/**
 * Combined unread count for the personal Notifications inbox: HR announcements
 * (Employee-scoped receipts) + CRM notifications (User-scoped). Drives the nav
 * badge on /me/notifications. Best-effort — returns 0 on any error so a badge
 * query never breaks the app shell.
 */
export async function countUnreadNotifications(userId: string): Promise<number> {
  try {
    const emp = await employeeForUser(userId);
    const [crm, hr] = await Promise.all([
      prisma.crmNotification.count({ where: { userId, readAt: null } }),
      emp
        ? prisma.hrNotificationReceipt.count({ where: { employeeId: emp.id, readAt: null } })
        : Promise.resolve(0),
    ]);
    return crm + hr;
  } catch {
    return 0;
  }
}
