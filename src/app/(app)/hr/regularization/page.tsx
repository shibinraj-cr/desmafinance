import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { employeeForUser } from "@/lib/hr-me";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { REGULARIZATION_REASONS } from "@/lib/hr-regularization";
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
  // Routing / no self-approval: an approver never sees their OWN requests, so
  // Soumya's requests route only to admin, and everyone else's to Soumya + admin.
  const myEmp = userId ? await employeeForUser(userId) : null;
  const notMine = myEmp ? { employeeId: { not: myEmp.id } } : {};

  const [requests, counts] = await Promise.all([
    prisma.hrAttendanceRegularization.findMany({
      where: { status, ...notMine },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { employee: { select: { empCode: true, name: true } } },
    }),
    prisma.hrAttendanceRegularization.groupBy({
      by: ["status"],
      where: notMine,
      _count: { _all: true },
    }),
  ]);
  const tally = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const reasonLabel = Object.fromEntries(REGULARIZATION_REASONS.map((r) => [r.code, r.label]));
  return (
    <>
      <TopBar
        title="Attendance Corrections"
        subtitle={`Approve punch, leave & explanation requests · Pending ${tally.pending ?? 0} · Approved ${tally.approved ?? 0} · Rejected ${tally.rejected ?? 0}`}
      />
      <div className="p-margin space-y-lg">
        <RegularizationReviewClient
          canDecide={canApproveHr(perms)}
          status={status}
          requests={requests.map((r) => ({
            id: r.id,
            empCode: r.employee.empCode,
            name: r.employee.name,
            date: r.date.toISOString().slice(0, 10),
            requestType: r.requestType,
            reasonType: r.reasonType,
            reasonLabel:
              r.requestType === "leave"
                ? "Leave request"
                : r.requestType === "note"
                  ? "Explanation (no change)"
                  : reasonLabel[r.reasonType] ?? r.reasonType,
            reason: r.reason,
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
