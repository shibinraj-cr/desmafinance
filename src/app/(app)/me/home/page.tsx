import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";

export const dynamic = "force-dynamic";

export default async function MeHomePage() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) redirect("/login");
  const employee = await prisma.employee.findUnique({
    where: { userId },
    include: { shift: true, leaveBalances: { orderBy: { year: "desc" }, take: 1 } },
  });
  return (
    <>
      <TopBar
        title={`Hello, ${employee?.name ?? perms.roleName}`}
        subtitle={employee ? `${employee.empCode} · ${employee.designation ?? ""}` : ""}
      />
      <div className="p-margin space-y-lg">
        {!employee && (
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">
              Your login isn&apos;t linked to an employee record yet. Ask HR to link your account from
              the Employees page.
            </p>
          </Section>
        )}
        {employee && (
          <Section title="Quick view">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-base">
              <Stat label="Shift" value={employee.shift?.code ?? "—"} />
              <Stat
                label="Leave balance"
                value={
                  employee.leaveBalances[0]
                    ? Number(employee.leaveBalances[0].balance).toFixed(1)
                    : "0.0"
                }
              />
              <Stat label="Bank" value={employee.bankName ?? "—"} />
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container rounded-lg p-md">
      <p className="text-caption text-on-surface-variant uppercase tracking-wider">{label}</p>
      <p className="text-h2 font-extrabold">{value}</p>
    </div>
  );
}
