import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
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
        salaryStructures: { orderBy: { effectiveFrom: "desc" } },
        leaveBalances: { orderBy: { year: "desc" } },
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
  const currentBalance = employee.leaveBalances.find((b) => b.year === currentYear);

  return (
    <>
      <TopBar
        title={employee.name}
        subtitle={`${employee.empCode} · ${employee.designation ?? "—"}`}
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
          currentBalance={
            currentBalance
              ? {
                  year: currentBalance.year,
                  opening: Number(currentBalance.opening),
                  accrued: Number(currentBalance.accrued),
                  used: Number(currentBalance.used),
                  balance: Number(currentBalance.balance),
                }
              : null
          }
        />
      </div>
    </>
  );
}
