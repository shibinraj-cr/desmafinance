import { redirect } from "next/navigation";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { loadEmployees, loadShifts } from "@/lib/hr-data";
import { EmployeesTable, ImportEmployeesButton, NewEmployeeButton } from "./client";

export const dynamic = "force-dynamic";

export default async function EmployeesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Employees" />
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
  const [employees, shifts] = await Promise.all([loadEmployees(), loadShifts()]);
  const canEdit = canApproveHr(perms);
  return (
    <>
      <TopBar
        title="Employees"
        subtitle={`${employees.length} on master · ${employees.filter((e) => e.active).length} active`}
        action={
          canEdit ? (
            <div className="flex gap-sm">
              <ImportEmployeesButton />
              <NewEmployeeButton
                shifts={shifts.map((s) => ({ id: s.id, code: s.code, name: s.name }))}
              />
            </div>
          ) : null
        }
      />
      <div className="p-margin">
        <EmployeesTable
          employees={employees}
          canEdit={canEdit}
          shifts={shifts.map((s) => ({ id: s.id, code: s.code, name: s.name }))}
        />
      </div>
    </>
  );
}
