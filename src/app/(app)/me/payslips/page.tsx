import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { employeeForUser } from "@/lib/hr-me";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { inr } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MyPayslipsPage() {
  const { userId } = await getCurrentUserAndPermissions();
  if (!userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp) {
    return (
      <>
        <TopBar title="Payslips" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">
              Your login isn&apos;t linked to an employee record yet. Ask HR to link your account.
            </p>
          </Section>
        </div>
      </>
    );
  }
  const lines = await prisma.hrSalaryRunLine.findMany({
    where: { employeeId: emp.id, run: { status: { not: "draft" } } },
    orderBy: { run: { monthKey: "desc" } },
    include: {
      run: { select: { id: true, monthKey: true, status: true, approvedAt: true } },
    },
    take: 36,
  });
  return (
    <>
      <TopBar title="My Payslips" subtitle={`${lines.length} approved slip${lines.length === 1 ? "" : "s"} available`} />
      <div className="p-margin">
        <Section title="">
          {lines.length === 0 ? (
            <p className="py-lg text-center text-on-surface-variant">
              No approved payroll runs yet. Once HR approves a run, your slip will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-label-sm">
                <thead className="bg-surface-container text-on-surface-variant uppercase tracking-wider text-caption">
                  <tr>
                    <th className="px-sm py-xs text-left">Month</th>
                    <th className="px-sm py-xs text-right">Days attended</th>
                    <th className="px-sm py-xs text-right">Gross</th>
                    <th className="px-sm py-xs text-right">Net</th>
                    <th className="px-sm py-xs text-left">Status</th>
                    <th className="px-sm py-xs text-right">Slip</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-outline-variant">
                      <td className="px-sm py-sm font-semibold">{l.run.monthKey}</td>
                      <td className="px-sm py-sm text-right tabular-nums">{Number(l.daysAttended).toFixed(1)}</td>
                      <td className="px-sm py-sm text-right tabular-nums">{inr(Number(l.salaryBeforeEsi))}</td>
                      <td className="px-sm py-sm text-right tabular-nums font-bold">{inr(Number(l.netSalary))}</td>
                      <td className="px-sm py-sm">
                        <span className="px-xs py-[1px] bg-green-100 text-green-800 rounded text-caption font-semibold uppercase">
                          {l.run.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-sm py-sm text-right">
                        <Link
                          href={`/me/payslips/${l.run.id}`}
                          className="px-sm py-[2px] rounded bg-primary text-on-primary text-caption font-semibold"
                        >
                          View / Download
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
