import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { listParam, oneOf } from "@/lib/filter-params";
import { ShiftAssignmentsClient } from "./client";

export const dynamic = "force-dynamic";

export default async function ShiftAssignmentsPage({
  searchParams,
}: {
  searchParams?: { employeeId?: string | string[]; status?: string | string[] };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Shift Assignments" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const employeeIds = listParam(searchParams?.employeeId);
  const statuses = listParam(searchParams?.status);
  const [employees, shifts, assignments] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { empCode: "asc" },
      select: { id: true, empCode: true, name: true, shiftId: true },
    }),
    prisma.hrShift.findMany({
      where: { active: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, startTime: true, endTime: true },
    }),
    prisma.hrShiftAssignment.findMany({
      where: {
        ...(employeeIds.length ? { employeeId: oneOf(employeeIds) } : {}),
        ...(statuses.length ? { status: oneOf(statuses) } : {}),
      },
      orderBy: [{ employeeId: "asc" }, { effectiveFrom: "desc" }],
      include: {
        shift: { select: { code: true, name: true, startTime: true, endTime: true } },
        employee: { select: { empCode: true, name: true } },
      },
      take: 500,
    }),
  ]);
  const pendingCount = await prisma.hrShiftAssignment.count({ where: { status: "pending" } });
  return (
    <>
      <TopBar
        title="Shift Assignments"
        subtitle={`${assignments.length} assignment${assignments.length === 1 ? "" : "s"} · ${pendingCount} pending review`}
      />
      <div className="p-margin space-y-lg">
        <ShiftAssignmentsClient
          canApprove={canApproveHr(perms)}
          employees={employees}
          shifts={shifts}
          assignments={assignments.map((a) => ({
            id: a.id,
            employeeId: a.employeeId,
            empCode: a.employee.empCode,
            name: a.employee.name,
            shiftId: a.shiftId,
            shiftCode: a.shift.code,
            shiftName: a.shift.name,
            startTime: a.shift.startTime,
            endTime: a.shift.endTime,
            effectiveFrom: a.effectiveFrom.toISOString().slice(0, 10),
            effectiveTo: a.effectiveTo ? a.effectiveTo.toISOString().slice(0, 10) : null,
            reason: a.reason,
            status: a.status,
            reviewNote: a.reviewNote,
          }))}
          filter={{ employeeId: employeeIds, status: statuses }}
        />
      </div>
    </>
  );
}
