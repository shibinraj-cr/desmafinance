import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { redact } from "./secrets";
import { BANK_PAGE } from "./constants";

/**
 * Alerts for the people who run the automation: every active Admin, plus
 * every active user whose role can approve AND is granted the Bank Statements
 * page (the "manage" capability in access.ts).
 *
 * Written to CrmNotification — the app's per-user bell, whose `kind` column
 * exists for exactly this (Personal Wealth and Hiring use it the same way).
 * Alerts name the account and the statement date and say what went wrong;
 * they never carry amounts or narrations — those stay behind the page grant.
 */
export async function bankAlertRecipients(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, role: true, roleRef: { select: { isAdmin: true, canApprove: true, pages: true } } },
  });
  return users
    .filter((u) => {
      if (u.roleRef) {
        if (u.roleRef.isAdmin) return true;
        return u.roleRef.canApprove && u.roleRef.pages.some((p) => p === BANK_PAGE || p.startsWith(`${BANK_PAGE}/`));
      }
      return u.role === "admin";
    })
    .map((u) => u.id);
}

export async function notifyBankAlert(a: { title: string; body: string; link?: string }): Promise<number> {
  try {
    const userIds = await bankAlertRecipients();
    if (userIds.length === 0) return 0;
    const { count } = await prisma.crmNotification.createMany({
      data: userIds.map((userId) => ({
        userId,
        kind: "bank_statement_alert",
        title: a.title.slice(0, 200),
        body: a.body.slice(0, 1000),
        linkUrl: a.link ?? `${BANK_PAGE}?tab=statements`,
      })),
    });
    return count;
  } catch (e) {
    logger.error("bank_alert_failed", { message: redact(e instanceof Error ? e.message : String(e)) });
    return 0;
  }
}
