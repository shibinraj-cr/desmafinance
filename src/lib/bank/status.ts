import { prisma } from "@/lib/prisma";
import { fromPrismaDate, toPrismaDate, todayIst } from "@/lib/lead-pulse-dates";
import { bankGoogleOAuthConfig, SHEETS_SCOPE } from "./gmail";
import { isArchiveConfigured } from "./storage";
import { maskedAccount, passwordStatus } from "./integration";
import { nextScheduledRun } from "./schedule";

/** Everything the Automation tab shows, in one serialisable object. No secrets. */
export async function automationStatus(integrationId: string) {
  const i = await prisma.bankIntegration.findUniqueOrThrow({
    where: { id: integrationId },
    include: { mailbox: { select: { emailAddress: true, scope: true, lastCheckedAt: true, lastError: true } } },
  });
  const today = todayIst();
  const monthStart = `${today.slice(0, 8)}01`;
  const [importedToday, monthProcessed, failed, review, lastRun, activeRun, pw] = await Promise.all([
    prisma.bankTransaction.count({ where: { integrationId, createdAt: { gte: new Date(`${today}T00:00:00+05:30`) } } }),
    prisma.bankStatement.count({
      where: { integrationId, status: { in: ["PROCESSED", "NO_TRANSACTIONS"] }, periodEnd: { gte: toPrismaDate(monthStart) } },
    }),
    prisma.bankStatement.count({ where: { integrationId, status: { in: ["FAILED", "MANUAL_ACTION_REQUIRED"] } } }),
    prisma.bankStatement.count({ where: { integrationId, status: "REVIEW_REQUIRED" } }),
    prisma.bankStatementRun.findFirst({
      where: { integrationId, trigger: { not: "TEST" }, status: { notIn: ["QUEUED", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, trigger: true, status: true, phase: true, completedAt: true },
    }),
    prisma.bankStatementRun.findFirst({
      where: { integrationId, status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, trigger: true },
    }),
    passwordStatus(i),
  ]);
  const next = nextScheduledRun({
    now: new Date(),
    enabled: i.automationEnabled,
    runTime: i.runTime,
    timeZone: i.timezone,
    lastScheduledRunOn: i.lastScheduledRunOn ? fromPrismaDate(i.lastScheduledRunOn) : null,
  });
  return {
    integration: {
      id: i.id,
      bankCode: i.bankCode,
      bankName: i.bankName,
      accountName: i.accountName,
      masked: maskedAccount(i.accountLastFour),
      emailSender: i.emailSender,
      emailRecipient: i.emailRecipient,
      emailSubjectPattern: i.emailSubjectPattern.replace(/\{last4\}/g, i.accountLastFour),
      automationEnabled: i.automationEnabled,
      runTime: i.runTime,
      timezone: i.timezone,
      lookbackDays: i.lookbackDays,
      alertAfterBusinessDays: i.alertAfterBusinessDays,
      browserAutomationEnabled: i.browserAutomationEnabled,
      pdfArchiveEnabled: i.pdfArchiveEnabled,
      failureScreenshots: i.failureScreenshots,
      sheetSyncEnabled: i.sheetSyncEnabled,
      sheetId: i.sheetId,
      sheetTab: i.sheetTab,
      lastSheetSyncAt: i.lastSheetSyncAt?.toISOString() ?? null,
      lastSheetSyncError: i.lastSheetSyncError,
    },
    connection: {
      oauthConfigured: !!bankGoogleOAuthConfig(),
      connected: !!i.mailbox,
      mailbox: i.mailbox?.emailAddress ?? null,
      sheetsAccess: !!i.mailbox?.scope?.includes(SHEETS_SCOPE),
      lastError: i.mailbox?.lastError ?? null,
      archiveConfigured: isArchiveConfigured(),
      password: { configured: pw.configured, source: pw.source, envName: pw.envName, updatedAt: pw.updatedAt?.toISOString() ?? null },
    },
    stats: {
      lastEmailCheckedAt: i.lastEmailCheckedAt?.toISOString() ?? null,
      lastStatementReceivedAt: i.lastStatementReceivedAt?.toISOString() ?? null,
      lastSuccessfulSyncAt: i.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastStatementDate: i.lastStatementDate ? fromPrismaDate(i.lastStatementDate) : null,
      nextRun: next,
      importedToday,
      monthProcessed,
      failed,
      review,
    },
    lastRun: lastRun ? { ...lastRun, completedAt: lastRun.completedAt?.toISOString() ?? null } : null,
    activeRunId: activeRun?.id ?? null,
  };
}

export type AutomationStatus = Awaited<ReturnType<typeof automationStatus>>;
