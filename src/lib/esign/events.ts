import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Append to an agreement's audit trail. The database trigger assigns the
 * sequence number, timestamp and hash chain (see the esign migration); callers
 * only say what happened. Rows can never be changed or removed afterwards.
 */
export async function recordEsignEvent(
  db: PrismaClient | Prisma.TransactionClient,
  e: {
    requestId: string;
    action: string;
    signerId?: string | null;
    actor?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    meta?: Prisma.InputJsonValue;
  },
): Promise<void> {
  await db.esignEvent.create({
    data: {
      requestId: e.requestId,
      action: e.action,
      signerId: e.signerId ?? null,
      actor: e.actor ?? null,
      ip: e.ip ?? null,
      userAgent: e.userAgent?.slice(0, 500) ?? null,
      meta: e.meta ?? {},
    },
  });
}

/** Caller's IP (first x-forwarded-for hop on Vercel) and user agent, for the trail. */
export function requestOrigin(req: Request): { ip: string | null; userAgent: string | null } {
  const fwd = req.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  return { ip, userAgent: req.headers.get("user-agent") };
}
