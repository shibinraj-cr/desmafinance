import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { computeMonthlyLeaveLedger, leaveLedgerYears } from "@/lib/hr-leave-balance";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { EmployeeEditor } from "./client";

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({ params }: { params: { id: string } }) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Employee" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              You don&apos;t have access to the HR module.
            </div>
          </Section>
        </div>
      </>
    );
  }
  const [employee, shifts, designations, departments, roles] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: params.id },
      include: {
        shift: true,
        designationRef: true,
        salaryStructures: { orderBy: { effectiveFrom: "desc" } },
        departments: { include: { department: true } },
        roleMemberships: { include: { role: true } },
      },
    }),
    prisma.hrShift.findMany({ orderBy: { code: "asc" } }),
    prisma.hrDesignation.findMany({
      where: { active: true },
      orderBy: [{ level: "desc" }, { name: "asc" }],
    }),
    prisma.hrDepartment.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    prisma.hrRole.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!employee) notFound();

  const currentYear = new Date().getUTCFullYear();
  const [leaveLedger, leaveYears] = await Promise.all([
    computeMonthlyLeaveLedger(employee.id, currentYear, { fill: "full" }),
    leaveLedgerYears(employee.id),
  ]);

  // Designation, department & role are the structured (Designation &
  // Departments tab) values — the single source of truth — falling back to
  // the legacy free-text columns only when no structured value is set.
  const designationName = employee.designationRef?.name ?? employee.designation ?? "";
  const primaryDept =
    employee.departments.find((d) => d.isPrimary) ?? employee.departments[0];
  const departmentName = primaryDept?.department.name ?? employee.department ?? "";
  const roleNames = employee.roleMemberships.map((r) => r.role.name);

  return (
    <>
      <TopBar
        title={employee.name}
        subtitle={`${employee.empCode} · ${designationName || "—"}`}
        action={
          <Link href="/hr/employees" className="text-label-sm underline">
            ← Back
          </Link>
        }
      />
      <div className="p-margin space-y-lg">
        <EmployeeEditor
          employee={{
            id: employee.id,
            empCode: employee.empCode,
            name: employee.name,
            dob: employee.dob ? employee.dob.toISOString().slice(0, 10) : "",
            designation: employee.designation ?? "",
            department: employee.department ?? "",
            email: employee.email ?? "",
            officialEmail: employee.officialEmail ?? "",
            phone: employee.phone ?? "",
            emergencyContact: employee.emergencyContact ?? "",
            officeNumber: employee.officeNumber ?? "",
            address: employee.address ?? "",
            highestEducation: employee.highestEducation ?? "",
            maritalStatus: employee.maritalStatus ?? "",
            experienceNotes: employee.experienceNotes ?? "",
            yearsOfExperience: employee.yearsOfExperience ?? "",
            aadhar: employee.aadhar ?? "",
            pan: employee.pan ?? "",
            accountNumber: employee.accountNumber ?? "",
            ifsc: employee.ifsc ?? "",
            bankName: employee.bankName ?? "",
            branch: employee.branch ?? "",
            joinDate: employee.joinDate ? employee.joinDate.toISOString().slice(0, 10) : "",
            shiftId: employee.shiftId ?? "",
            halfHourConcession: employee.halfHourConcession,
            active: employee.active,
            designationId: employee.designationId ?? "",
            departments: employee.departments.map((d) => ({
              departmentId: d.departmentId,
              isPrimary: d.isPrimary,
            })),
            roleIds: employee.roleMemberships.map((r) => r.roleId),
          }}
          designationName={designationName}
          departmentName={departmentName}
          roleNames={roleNames}
          designations={designations.map((d) => ({
            id: d.id,
            name: d.name,
            level: d.level,
          }))}
          departmentsList={departments.map((d) => ({ id: d.id, name: d.name }))}
          rolesList={roles.map((r) => ({ id: r.id, name: r.name }))}
          shifts={shifts.map((s) => ({ id: s.id, code: s.code, name: s.name }))}
          structures={employee.salaryStructures.map((s) => ({
            id: s.id,
            effectiveFrom: s.effectiveFrom.toISOString().slice(0, 10),
            basic: Number(s.basic),
            hraPct: Number(s.hraPct),
            conveyancePct: Number(s.conveyancePct),
            medicalPct: Number(s.medicalPct),
            specialPct: Number(s.specialPct),
            esiApplicable: s.esiApplicable,
            pfApplicable: s.pfApplicable,
            professionalTax: Number(s.professionalTax),
            notes: s.notes,
          }))}
          canEdit={canApproveHr(perms)}
          leaveTab={{
            employeeId: employee.id,
            year: currentYear,
            availableYears: leaveYears,
            opening: leaveLedger.opening,
            balanceAsOn: leaveLedger.balanceAsOn,
            currentMonth: leaveLedger.currentMonth,
            rows: leaveLedger.rows,
          }}
        />
      </div>
    </>
  );
}
