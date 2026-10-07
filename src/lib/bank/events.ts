import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { redact } from "./secrets";

/**
 * The per-run / per-statement timeline (Audit Log tab, statement drawer) and
 * the structured server log, written together. Every message passes through
 * the redactor first, with any secret the caller holds, so a password or a
 * statement link can never land in either.
 */
export async function logEvent(e: {
  integrationId?: string | null;
  runId?: string | null;
  statementId?: string | null;
  level?: "info" | "warn" | "error";
  step: string;
  message: string;
  userId?: string | null;
  secrets?: Array<string | null | undefined>;
}): Promise<void> {
  const message = redact(e.message, e.secrets).slice(0, 1000);
  const level = e.level ?? "info";
  logger[level]("bank_automation", {
    integrationId: e.integrationId ?? undefined,
    runId: e.runId ?? undefined,
    statementId: e.statementId ?? undefined,
    step: e.step,
    detail: message,
  });
  try {
    await prisma.bankAutomationEvent.create({
      data: {
        integrationId: e.integrationId ?? null,
        runId: e.runId ?? null,
        statementId: e.statementId ?? null,
        level,
        step: e.step,
        message,
        userId: e.userId ?? null,
      },
    });
  } catch (err) {
    // The timeline is diagnostics; it must never fail the import itself.
    logger.warn("bank_event_write_failed", { message: redact(err instanceof Error ? err.message : String(err)) });
  }
}
