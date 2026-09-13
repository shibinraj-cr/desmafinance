/**
 * SOP audit trail (§16).
 *
 * Best-effort and never throwing, exactly like `recordAudit` and
 * `recordLeadActivity`: an audit write failing must not roll back the action
 * the user actually asked for. The trade-off is deliberate and one-directional
 * — we would rather have a published SOP with a missing log line than a failed
 * publish because the log table hiccuped.
 *
 * Request metadata (IP, user agent) is read from the incoming request headers
 * where the caller has them. `next/headers` is only available in a request
 * scope, so `requestMeta()` degrades to nulls rather than throwing when called
 * from a script or a background path.
 */

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { SopAuditAction } from "./constants";

export type SopAuditMeta = { ipAddress: string | null; userAgent: string | null };

/** IP + user agent for the current request, or nulls outside a request scope. */
export function requestMeta(): SopAuditMeta {
  try {
    const h = headers();
    // Vercel puts the client IP in x-forwarded-for; the first entry is the
    // client, the rest are proxies.
    const fwd = h.get("x-forwarded-for");
    const ip = fwd ? (fwd.split(",")[0]?.trim() ?? null) : (h.get("x-real-ip") ?? null);
    return { ipAddress: ip, userAgent: h.get("user-agent") };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

export type RecordSopAuditInput = {
  sopId: string;
  versionId?: string | null;
  versionLabel?: string | null;
  userId?: string | null;
  action: SopAuditAction;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown> | null;
  /** Pass false for high-volume, low-value entries (a page view) in a loop. */
  withRequestMeta?: boolean;
};

export async function recordSopAudit(input: RecordSopAuditInput): Promise<void> {
  try {
    const meta = input.withRequestMeta === false ? { ipAddress: null, userAgent: null } : requestMeta();
    await prisma.sopAuditLog.create({
      data: {
        sopId: input.sopId,
        versionId: input.versionId ?? null,
        versionLabel: input.versionLabel ?? null,
        userId: input.userId ?? null,
        action: input.action,
        field: input.field ?? null,
        oldValue: stringifyValue(input.oldValue),
        newValue: stringifyValue(input.newValue),
        metadata: (input.metadata ?? undefined) as object | undefined,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      },
    });
  } catch (e) {
    console.error("[sop-audit] failed to record entry:", e);
  }
}

/**
 * Write one audit row per changed field of a draft edit, so the log answers
 * "what did they change?" rather than only "they saved".
 *
 * Fields whose value did not actually move are skipped — a save that touched
 * nothing should leave no trail, or the log fills with noise and stops being
 * read.
 */
export async function recordSopFieldChanges(
  base: Omit<RecordSopAuditInput, "action" | "field" | "oldValue" | "newValue">,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  action: SopAuditAction = "DRAFT_EDITED",
): Promise<void> {
  const changed = Object.keys(after).filter(
    (k) => stringifyValue(before[k]) !== stringifyValue(after[k]),
  );
  if (changed.length === 0) return;
  // One row per field, but the request metadata is read once.
  const meta = requestMeta();
  try {
    await prisma.sopAuditLog.createMany({
      data: changed.map((field) => ({
        sopId: base.sopId,
        versionId: base.versionId ?? null,
        versionLabel: base.versionLabel ?? null,
        userId: base.userId ?? null,
        action,
        field,
        oldValue: stringifyValue(before[field]),
        newValue: stringifyValue(after[field]),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent?.slice(0, 500) ?? null,
      })),
    });
  } catch (e) {
    console.error("[sop-audit] failed to record field changes:", e);
  }
}

/**
 * One string form for every value type the log stores, so `oldValue` and
 * `newValue` compare cleanly and read cleanly. Long text is truncated: the log
 * records THAT the purpose changed, not a second copy of it.
 */
function stringifyValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  if (typeof v === "object") return truncate(JSON.stringify(v));
  return truncate(String(v));
}

function truncate(s: string, max = 1000): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
