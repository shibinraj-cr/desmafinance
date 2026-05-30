import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser } from "@/lib/hr-rbac";
import { recomputeAllLeaveBalances } from "@/lib/hr-leave-balance";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";

export const dynamic = "force-dynamic";

export default async function LeaveBalancesPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Leave Balances" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }
  const year = new Date().getUTCFullYear();
  // Recompute before reading so the table always reflects current per-employee
  // eligibility and the latest reviewed/decided leave, without waiting on the
  // monthly accrual job.
  await recomputeAllLeaveBalances(year);
  const rows = await prisma.hrLeaveBalance.findMany({
    where: { year },
    include: { employee: true },
    orderBy: [{ employee: { name: "asc" } }],
  });
  return (
    <>
      <TopBar title="Leave Balances" subtitle={`Year ${year}`} />
      <div className="p-margin">
        <Section title="">
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="py-sm pr-md">Employee</th>
                  <th className="py-sm pr-md">Opening</th>
                  <th className="py-sm pr-md">Accrued</th>
                  <th className="py-sm pr-md">Used</th>
                  <th className="py-sm pr-md">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant last:border-0">
                    <td className="py-sm pr-md font-semibold">
                      {r.employee.empCode} — {r.employee.name}
                    </td>
                    <td className="py-sm pr-md">{Number(r.opening).toFixed(1)}</td>
                    <td className="py-sm pr-md">{Number(r.accrued).toFixed(1)}</td>
                    <td className="py-sm pr-md">{Number(r.used).toFixed(1)}</td>
                    <td className="py-sm pr-md font-bold">{Number(r.balance).toFixed(1)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-lg text-center text-on-surface-variant">
                      No balances yet. Run attendance import to seed.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
