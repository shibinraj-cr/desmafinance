import { prisma } from "./prisma";

type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "RESTORE"
  | "SUBMIT_CREATE"
  | "SUBMIT_UPDATE"
  | "SUBMIT_DELETE"
  | "APPROVE_CREATE"
  | "APPROVE_UPDATE"
  | "APPROVE_DELETE"
  | "REJECT";

export async function recordAudit(opts: {
  entityType: string;
  entityId: string;
  action: AuditAction;
  userId?: string | null;
  changes?: unknown;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: opts.entityType,
        entityId: opts.entityId,
        action: opts.action,
        userId: opts.userId ?? null,
        changes: opts.changes ? (opts.changes as object) : undefined,
      },
    });
  } catch (e) {
    // Never let audit-log failures break the user-facing operation.
    console.error("[audit] failed to record entry:", e);
  }
}
