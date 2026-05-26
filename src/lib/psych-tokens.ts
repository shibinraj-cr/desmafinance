import crypto from "crypto";
import { prisma } from "./prisma";

/** Default time-to-live for a fresh assignment token (hours). */
export const DEFAULT_TTL_HOURS = 72;

/** Hard cap on the number of start attempts per token within the active window. */
export const MAX_START_ATTEMPTS = 3;

export function generateRawToken(): string {
  return crypto.randomUUID();
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function hashToken(rawToken: string, salt: string): string {
  return crypto.createHash("sha256").update(rawToken + ":" + salt).digest("hex");
}

export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

/**
 * Look up an assignment by raw token. Iterates over candidate salts —
 * since SHA-256 is fast and the assignment table will stay small
 * (< a few hundred per cycle) this is fine; if it grows we can switch
 * to a deterministic salt scheme.
 */
export async function findAssignmentByRawToken(rawToken: string) {
  if (!rawToken || typeof rawToken !== "string") return null;
  const candidates = await prisma.psychAssignment.findMany({
    where: {
      status: { in: ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "EXPIRED"] },
    },
    select: { id: true, tokenHash: true, tokenSalt: true },
  });
  for (const c of candidates) {
    if (hashToken(rawToken, c.tokenSalt) === c.tokenHash) {
      return prisma.psychAssignment.findUnique({
        where: { id: c.id },
        include: {
          employee: { include: { departments: { include: { department: true } } } },
          test: { include: { questions: { where: { active: true }, orderBy: { order: "asc" } } } },
          responses: true,
        },
      });
    }
  }
  return null;
}
