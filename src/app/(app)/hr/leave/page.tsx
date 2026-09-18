import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { reviewQueueScope, canApproveHrApproverRequests } from "@/lib/hr-approval-routing";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { halfSessionLabel } from "@/lib/hr-regularization";
import { RegularizationReviewClient } from "../regularization/client";

export const dynamic = "force-dynamic";

/**
 * Leave Requests — the HR leave queue.
 *
 * This page used to read `HrLeaveRequest`, the retired forward-dated leave
 * flow. Nothing has written to that table since leave moved onto the
 * regularization pipeline, so the page showed an empty table — and its approve
 * buttons flipped a status badge without touching attendance or payroll — while
 * real requests waited under "Attendance Corrections". HR looked here, saw
 * nothing, and reported that leave applications were not coming through.
 *
 * It now reads the live source (`HrAttendanceRegularization` rows of type
 * "leave") and reuses the corrections reviewer, so approving here runs the one
 * approval path that actually writes the attendance day, rules on paid vs
 * unpaid, re-applies the sandwich rule and refreshes the leave balance.
 */
export default async function HrLeavePage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Leave Requests" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const status = searchParams?.status ?? "pending";
  // Same approval routing as the corrections queue: an approver never sees
  // their own request, and an HR approver's request is shown only to the
  // designated approver. The API route enforces it; this keeps the queue honest.
  const notMine = await reviewQueueScope(userId, perms);
  const isDesignated = await canApproveHrApproverRequests(userId, perms);

  const where = { requestType: "leave", ...notMine };
  const [requests, counts] = await Promise.all([
    prisma.hrAttendanceRegularization.findMany({
      where: { status, ...where },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { employee: { select: { empCode: true, name: true } } },
    }),
    prisma.hrAttendanceRegularization.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);
  const tally = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));

  return (
    <>
      <TopBar
        title="Leave Requests"
        subtitle={`Pending ${tally.pending ?? 0} · Approved ${tally.approved ?? 0} · Rejected ${tally.rejected ?? 0}${isDesignated ? "" : " · HR approvers' own requests route to the designated approver"}`}
      />
      <div className="p-margin space-y-lg">
        <RegularizationReviewClient
          canDecide={canApproveHr(perms)}
          status={status}
          basePath="/hr/leave"
          emptyLabel="leave requests"
          requests={requests.map((r) => ({
            id: r.id,
            empCode: r.employee.empCode,
            name: r.employee.name,
            date: r.date.toISOString().slice(0, 10),
            toDate: r.toDate ? r.toDate.toISOString().slice(0, 10) : null,
            requestType: r.requestType,
            reasonType: r.reasonType,
            reasonLabel: halfSessionLabel(r.halfSession)
              ? `Half-day leave · ${halfSessionLabel(r.halfSession)}`
              : "Leave request (full day)",
            reason: r.reason,
            halfSession: r.halfSession,
            proposedIn: r.proposedIn,
            proposedOut: r.proposedOut,
            status: r.status,
            attachmentUrl: r.attachmentUrl,
            createdAt: r.createdAt.toISOString(),
            reviewNote: r.reviewNote,
          }))}
        />
      </div>
    </>
  );
}
