import { prisma } from "./prisma";
import { hrApproverEmployeeIds, designatedLeaveApproverIds } from "./hr-approval-routing";
import { halfSessionLabel } from "./hr-regularization";

/**
 * In-app notifications for the leave / attendance request flow.
 *
 * Neither leg of this flow told anyone anything. An employee filed a request
 * and HR only found out by visiting the queue; HR decided it and the employee
 * only found out by checking back. `HrNotification` was already wired for
 * birthdays, policies and trainings — it just was never used for the one flow
 * where both sides are waiting on each other.
 *
 * Delivery rides on the existing HrNotification + receipt pair, which
 * `/api/me/notifications` already merges into the personal inbox, so nothing
 * new has to be built on the read side.
 *
 * Every function here is BEST-EFFORT: a notification failure must never fail
 * the request or the decision it is reporting on. Callers await them after the
 * write has committed.
 */

export function kindLabel(requestType: string, halfSession: string | null): string {
  if (requestType === "leave") {
    const half = halfSessionLabel(halfSession);
    return half ? `Half-day leave (${half.toLowerCase()})` : "Leave";
  }
  if (requestType === "note") return "Explanation";
  return "Punch correction";
}

/**
 * Employee ids that should be told about a new request from `requesterId`.
 *
 * Mirrors `leaveDecisionBlockedReason`, so the people notified are exactly the
 * people allowed to act: normally the HR approver pool, but a request from
 * someone who themselves holds HR approval rights routes to the designated
 * approver instead. The requester is never notified about their own request.
 */
export async function approverEmployeeIdsFor(requesterId: string): Promise<string[]> {
  const approverEmps = await hrApproverEmployeeIds();
  const requesterIsApprover = approverEmps.includes(requesterId);

  if (requesterIsApprover) {
    // Routes to the designated approver (or, if none resolves, any Admin —
    // matching canApproveHrApproverRequests' fallback).
    const designatedUserIds = await designatedLeaveApproverIds();
    const where = designatedUserIds.length
      ? { userId: { in: designatedUserIds } }
      : {
          user: {
            is: {
              isActive: true,
              roleRef: { is: { isAdmin: true } },
            },
          },
        };
    const emps = await prisma.employee.findMany({ where, select: { id: true } });
    return emps.map((e) => e.id).filter((id) => id !== requesterId);
  }

  return approverEmps.filter((id) => id !== requesterId);
}

/** Tell the routed approvers that a request is waiting. */
export async function notifyRequestSubmitted(args: {
  employeeId: string;
  employeeName: string;
  requestType: string;
  halfSession: string | null;
  date: Date;
  reason: string;
}): Promise<void> {
  try {
    const recipients = await approverEmployeeIdsFor(args.employeeId);
    if (recipients.length === 0) return;
    const iso = args.date.toISOString().slice(0, 10);
    const label = kindLabel(args.requestType, args.halfSession);
    // Leave requests live on the Leave Requests page; punch fixes and
    // explanations on Attendance Corrections.
    const linkUrl = args.requestType === "leave" ? "/hr/leave" : "/hr/regularization";
    await prisma.$transaction(async (tx) => {
      const note = await tx.hrNotification.create({
        data: {
          title: `${label} request · ${args.employeeName}`,
          body: `${args.employeeName} requested ${label.toLowerCase()} for ${iso}. Reason: ${args.reason}`,
          linkUrl,
          kind: "request_submitted",
        },
      });
      await tx.hrNotificationReceipt.createMany({
        data: recipients.map((employeeId) => ({ notificationId: note.id, employeeId })),
        skipDuplicates: true,
      });
    });
  } catch {
    // Best-effort: never fail the submission because the notification failed.
  }
}

/** Tell the employee what HR decided. */
export async function notifyRequestDecided(args: {
  employeeId: string;
  requestType: string;
  halfSession: string | null;
  date: Date;
  decision: "approve" | "reject" | "clarify";
  /** For an approved leave: the status actually written (LV paid / A unpaid). */
  leaveStatus?: "LV" | "A" | null;
  reviewNote?: string | null;
}): Promise<void> {
  try {
    const iso = args.date.toISOString().slice(0, 10);
    const label = kindLabel(args.requestType, args.halfSession);
    const outcome =
      args.decision === "approve"
        ? "approved"
        : args.decision === "reject"
          ? "rejected"
          : "sent back for clarification";
    // On an approved leave, say whether it was granted paid or unpaid — that is
    // the part that affects pay, and the employee could not see it anywhere.
    const payNote =
      args.decision === "approve" && args.requestType === "leave" && args.leaveStatus
        ? args.leaveStatus === "LV"
          ? " Granted as paid leave (deducted from your leave balance)."
          : " Granted as unpaid leave (loss of pay)."
        : "";
    const body =
      `Your ${label.toLowerCase()} request for ${iso} was ${outcome}.` +
      payNote +
      (args.reviewNote ? ` Note from HR: ${args.reviewNote}` : "");
    await prisma.$transaction(async (tx) => {
      const note = await tx.hrNotification.create({
        data: {
          title: `${label} request ${outcome}`,
          body,
          linkUrl: args.requestType === "leave" ? "/me/leave" : "/me/regularization",
          kind: "request_decided",
        },
      });
      await tx.hrNotificationReceipt.create({
        data: { notificationId: note.id, employeeId: args.employeeId },
      });
    });
  } catch {
    // Best-effort: the decision has already been written and must stand.
  }
}
