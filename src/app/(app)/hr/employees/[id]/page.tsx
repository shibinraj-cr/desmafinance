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
  const [employee, shifts] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: params.id },
      include: {
        shift: true,
        salaryStructures: { orderBy: { effectiveFrom: "desc" } },
        leaveBalances: { orderBy: { year: "desc" } },
      },
    }),
    prisma.hrShift.findMany({ orderBy: { code: "asc" } }),
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
          }}
          shifts={shifts.map((s) => ({ id: s.id, code: s.code, name: s.name }))}
          structures={employee.salaryStructures.map((s) => ({
            id: s.id,
            effectiveFrom: s.effectiveFrom.toISOString().slice(0, 10),
            monthlySalary: Number(s.monthlySalary),
            basicPct: Number(s.basicPct),
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
