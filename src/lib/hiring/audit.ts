import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

/**
 * Write audit for the hiring module (§6: jobs, offers, partners, roles, keys).
 *
 * Separate from the finance `AuditLog` on purpose — that table is keyed to
 * finance's own action vocabulary, and mixing hiring rows into it would make
 * both harder to read. Same contract though: an audit failure must NEVER break
 * the user-facing operation.
 */
export async function recordHiringAudit(opts: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await prisma.hiringAuditLog.create({
      data: {
        actorId: opts.actorId,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        before: (opts.before ?? undefined) as never,
        after: (opts.after ?? undefined) as never,
        ip: clientIp(),
      },
    });
  } catch (e) {
    logger.error("hiring_audit_failed", {
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Best-effort caller IP from the proxy headers Vercel sets. */
export function clientIp(): string | null {
  try {
    const h = headers();
    const fwd = h.get("x-forwarded-for");
    if (fwd) return fwd.split(",")[0]!.trim();
    return h.get("x-real-ip");
  } catch {
    // `headers()` throws outside a request scope (e.g. a seed script).
    return null;
  }
}
