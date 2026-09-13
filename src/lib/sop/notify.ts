/**
 * SOP in-app notifications (§22).
 *
 * Best-effort and never throwing — the same contract as `crm-notify.ts`. A
 * notification failing must not roll back the publish that triggered it.
 *
 * The app has no single generic notification table (CRM and HR each own one),
 * so the SOP module owns `SopNotification`, copying `CrmNotification`'s shape
 * exactly. That is what lets the notification page, the unread badge and the
 * mark-read route be near-identical across modules.
 *
 * Channel readiness: every event goes through `notifySop`, so adding email or
 * WhatsApp later is a change in ONE function, not at each of the eleven call
 * sites. The row is written first and any future outbound send hangs off it —
 * an in-app record is the durable one.
 */

import { prisma } from "@/lib/prisma";
import type { SopNotificationKind } from "./constants";

export type SopNotifyInput = {
  /** Recipients as User ids. Duplicates and nulls are dropped. */
  userIds: (string | null | undefined)[];
  kind: SopNotificationKind;
  title: string;
  body: string;
  linkUrl?: string | null;
  sopId?: string | null;
  versionId?: string | null;
  /** Never notify the person who caused the event about their own action. */
  actorUserId?: string | null;
};

/** Write one notification row per distinct recipient. Never throws. */
export async function notifySop(input: SopNotifyInput): Promise<void> {
  try {
    const recipients = [...new Set(input.userIds.filter((u): u is string => !!u))].filter(
      (u) => u !== input.actorUserId,
    );
    if (recipients.length === 0) return;

    await prisma.sopNotification.createMany({
      data: recipients.map((userId) => ({
        userId,
        kind: input.kind,
        title: input.title,
        body: input.body,
        linkUrl: input.linkUrl ?? null,
        sopId: input.sopId ?? null,
        versionId: input.versionId ?? null,
      })),
    });
  } catch (e) {
    console.error("[sop-notify] failed to write notification:", e);
  }
}

/**
 * The User ids behind a set of Employee ids. Employees without a login are
 * silently skipped — they cannot receive an in-app notification, and that is a
 * fact about the account, not an error worth failing a publish over.
 */
export async function userIdsForEmployees(employeeIds: string[]): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  const rows = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, userId: { not: null } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId!).filter(Boolean);
}

/** The login behind one employee, or null. */
export async function userIdForEmployee(employeeId: string | null | undefined): Promise<string | null> {
  if (!employeeId) return null;
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });
  return row?.userId ?? null;
}

/** The user's unread SOP-notification count. Best-effort — 0 on any error. */
export async function countUnreadSopNotifications(userId: string): Promise<number> {
  return prisma.sopNotification.count({ where: { userId, readAt: null } }).catch(() => 0);
}

// ── Event helpers ───────────────────────────────────────────────────────────
// One per workflow event, so call sites read as the event rather than as a
// notification payload, and the copy stays consistent across the module.

type SopRef = { id: string; sopNumber: string; title: string };

export function sopLink(sopId: string): string {
  return `/sop/${sopId}`;
}

export async function notifyReviewRequested(opts: {
  sop: SopRef;
  versionId: string;
  versionLabel: string;
  reviewerId: string | null;
  actorUserId: string;
}): Promise<void> {
  await notifySop({
    userIds: [opts.reviewerId],
    kind: "review_assigned",
    title: "SOP assigned to you for review",
    body: `${opts.sop.sopNumber} — ${opts.sop.title} (${opts.versionLabel}) is waiting on your review.`,
    linkUrl: sopLink(opts.sop.id),
    sopId: opts.sop.id,
    versionId: opts.versionId,
    actorUserId: opts.actorUserId,
  });
}

export async function notifyApprovalRequested(opts: {
  sop: SopRef;
  versionId: string;
  versionLabel: string;
  approverId: string | null;
  actorUserId: string;
}): Promise<void> {
  await notifySop({
    userIds: [opts.approverId],
    kind: "approval_assigned",
    title: "SOP awaiting your approval",
    body: `${opts.sop.sopNumber} — ${opts.sop.title} (${opts.versionLabel}) has passed review and needs your approval.`,
    linkUrl: sopLink(opts.sop.id),
    sopId: opts.sop.id,
    versionId: opts.versionId,
    actorUserId: opts.actorUserId,
  });
}

export async function notifyChangesRequested(opts: {
  sop: SopRef;
  versionId: string;
  versionLabel: string;
  recipients: (string | null)[];
  comments: string | null;
  actorUserId: string;
}): Promise<void> {
  await notifySop({
    userIds: opts.recipients,
    kind: "changes_requested",
    title: "Changes requested on your SOP",
    body: opts.comments?.trim()
      ? `${opts.sop.sopNumber} — ${opts.sop.title} (${opts.versionLabel}): ${opts.comments.trim()}`
      : `${opts.sop.sopNumber} — ${opts.sop.title} (${opts.versionLabel}) was sent back for changes.`,
    linkUrl: sopLink(opts.sop.id),
    sopId: opts.sop.id,
    versionId: opts.versionId,
    actorUserId: opts.actorUserId,
  });
}

export async function notifyApproved(opts: {
  sop: SopRef;
  versionId: string;
  versionLabel: string;
  recipients: (string | null)[];
  actorUserId: string;
}): Promise<void> {
  await notifySop({
    userIds: opts.recipients,
    kind: "sop_approved",
    title: "SOP approved",
    body: `${opts.sop.sopNumber} — ${opts.sop.title} (${opts.versionLabel}) is approved and ready to publish.`,
    linkUrl: sopLink(opts.sop.id),
    sopId: opts.sop.id,
    versionId: opts.versionId,
    actorUserId: opts.actorUserId,
  });
}

export async function notifyPublished(opts: {
  sop: SopRef;
  versionId: string;
  versionLabel: string;
  recipients: (string | null)[];
  requiresAcknowledgement: boolean;
  deadline: Date | null;
  actorUserId: string;
}): Promise<void> {
  const deadline = opts.deadline
    ? ` Please acknowledge by ${opts.deadline.toISOString().slice(0, 10)}.`
    : "";
  await notifySop({
    userIds: opts.recipients,
    kind: opts.requiresAcknowledgement ? "acknowledgement_required" : "sop_published",
    title: opts.requiresAcknowledgement ? "New SOP — acknowledgement required" : "New SOP published",
    body: `${opts.sop.sopNumber} — ${opts.sop.title} (${opts.versionLabel}) is now published.${deadline}`,
    linkUrl: sopLink(opts.sop.id),
    sopId: opts.sop.id,
    versionId: opts.versionId,
    actorUserId: opts.actorUserId,
  });
}

export async function notifyCriticalEscalation(opts: {
  sop: SopRef;
  versionId: string;
  recipients: (string | null)[];
  issue: string;
  actorUserId?: string | null;
}): Promise<void> {
  await notifySop({
    userIds: opts.recipients,
    kind: "critical_escalation",
    title: "Critical exception on a published SOP",
    body: `${opts.sop.sopNumber} — ${opts.sop.title}: ${opts.issue}`,
    linkUrl: sopLink(opts.sop.id),
    sopId: opts.sop.id,
    versionId: opts.versionId,
    actorUserId: opts.actorUserId ?? null,
  });
}
