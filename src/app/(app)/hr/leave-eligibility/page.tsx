import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { LeaveEligibilityClient } from "./client";

export const dynamic = "force-dynamic";

export default async function LeaveEligibilityPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Monthly Leave Eligibility" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const [employees, eligibilities, recentAccruals] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { empCode: "asc" },
      select: { id: true, empCode: true, name: true, joinDate: true },
    }),
    prisma.hrLeaveEligibility.findMany({
      include: { employee: { select: { empCode: true, name: true } } },
    }),
    prisma.hrLeaveAccrual.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { employee: { select: { empCode: true, name: true } } },
    }),
  ]);
  const map = new Map(eligibilities.map((e) => [e.employeeId, e]));
  const rows = employees.map((emp) => {
    const elig = map.get(emp.id);
    return {
      id: emp.id,
      empCode: emp.empCode,
      name: emp.name,
      joinDate: emp.joinDate ? emp.joinDate.toISOString().slice(0, 10) : null,
      eligibility: elig
        ? {
            enabled: elig.enabled,
            frequency: elig.frequency,
            effectiveFrom: elig.effectiveFrom.toISOString().slice(0, 10),
            leavesPerPeriod: Number(elig.leavesPerPeriod),
            leaveType: elig.leaveType,
            carryForward: elig.carryForward,
            carryForwardCap: Number(elig.carryForwardCap),
            expiryMonths: elig.expiryMonths,
            notes: elig.notes,
          }
        : null,
    };
  });
  const enabledCount = rows.filter((r) => r.eligibility?.enabled).length;
  return (
    <>
      <TopBar
        title="Monthly Leave Eligibility"
        subtitle={`${enabledCount} of ${rows.length} employees enabled`}
      />
      <div className="p-margin space-y-lg">
        <LeaveEligibilityClient
          canEdit={canApproveHr(perms)}
          employees={rows}
          recent={recentAccruals.map((a) => ({
            id: a.id,
            empCode: a.employee.empCode,
            name: a.employee.name,
            periodKey: a.periodKey,
            delta: Number(a.delta),
            source: a.source,
            leaveType: a.leaveType,
            reason: a.reason,
            createdAt: a.createdAt.toISOString(),
          }))}
        />
      </div>
    </>
  );
}
