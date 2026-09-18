import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import {
  reviewQueueScope,
  canApproveHrApproverRequests,
} from "@/lib/hr-approval-routing";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { REGULARIZATION_REASONS, halfSessionLabel } from "@/lib/hr-regularization";
import { RegularizationReviewClient } from "./client";

export const dynamic = "force-dynamic";

export default async function RegularizationReviewPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Attendance Corrections" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const status = searchParams?.status ?? "pending";
  // Approval routing: an approver never sees their OWN requests, and an HR
  // approver's requests are shown only to the designated approver — so an HR
  // Manager's leave routes to the owner, and everyone else's to HR + the owner.
  // The API route enforces the same rule. See hr-approval-routing.
  const notMine = await reviewQueueScope(userId, perms);
  const isDesignated = await canApproveHrApproverRequests(userId, perms);

  // Leave requests have their own page (/hr/leave) in the LEAVE group, where HR
  // looks for them. This queue keeps punch corrections and explanations.
  const kind = { requestType: { in: ["punch", "note"] } };
  const [requests, counts] = await Promise.all([
    prisma.hrAttendanceRegularization.findMany({
      where: { status, ...kind, ...notMine },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { employee: { select: { empCode: true, name: true } } },
    }),
    prisma.hrAttendanceRegularization.groupBy({
      by: ["status"],
      where: { ...kind, ...notMine },
      _count: { _all: true },
    }),
  ]);
  const tally = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const reasonLabel = Object.fromEntries(REGULARIZATION_REASONS.map((r) => [r.code, r.label]));
  return (
    <>
      <TopBar
        title="Attendance Corrections"
        subtitle={`Approve punch & explanation requests · Leave requests are on the Leave Requests page · Pending ${tally.pending ?? 0} · Approved ${tally.approved ?? 0} · Rejected ${tally.rejected ?? 0}${isDesignated ? "" : " · HR approvers' own requests route to the designated approver"}`}
      />
      <div className="p-margin space-y-lg">
        <RegularizationReviewClient
          canDecide={canApproveHr(perms)}
          status={status}
          emptyLabel="correction requests"
          requests={requests.map((r) => ({
            id: r.id,
            empCode: r.employee.empCode,
            name: r.employee.name,
            date: r.date.toISOString().slice(0, 10),
            requestType: r.requestType,
            reasonType: r.reasonType,
            reasonLabel:
              r.requestType === "leave"
                ? halfSessionLabel(r.halfSession)
                  ? `Half-day leave · ${halfSessionLabel(r.halfSession)}`
                  : "Leave request (full day)"
                : r.requestType === "note"
                  ? "Explanation (no change)"
                  : reasonLabel[r.reasonType] ?? r.reasonType,
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
