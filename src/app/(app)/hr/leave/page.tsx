import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { LeaveReviewer } from "./client";

export const dynamic = "force-dynamic";

export default async function HrLeavePage() {
  const { perms } = await getCurrentUserAndPermissions();
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
  const requests = await prisma.hrLeaveRequest.findMany({
    orderBy: [{ status: "asc" }, { fromDate: "desc" }],
    take: 200,
    include: {
      employee: { select: { id: true, empCode: true, name: true } },
      reviewedBy: { select: { username: true } },
    },
  });
  const pending = requests.filter((r) => r.status === "pending").length;
  return (
    <>
      <TopBar title="Leave Requests" subtitle={`${pending} pending · ${requests.length} total`} />
      <div className="p-margin">
        <LeaveReviewer
          requests={requests.map((r) => ({
            id: r.id,
            employeeCode: r.employee.empCode,
            employeeName: r.employee.name,
            fromDate: r.fromDate.toISOString().slice(0, 10),
            toDate: r.toDate.toISOString().slice(0, 10),
            days: Number(r.days),
            leaveType: r.leaveType,
            reason: r.reason,
            status: r.status,
            reviewedBy: r.reviewedBy?.username ?? null,
            reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
            reviewNote: r.reviewNote,
          }))}
          canDecide={canApproveHr(perms)}
        />
      </div>
    </>
  );
}
