import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { employeeForUser } from "@/lib/hr-me";
import { isOwnerDesignation } from "@/lib/hr-salary-engine";
import { computeMonthlyLeaveLedger } from "@/lib/hr-leave-balance";
import { MyLeaveClient } from "./client";

export const dynamic = "force-dynamic";

export default async function MyLeavePage() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) redirect("/login");
  const emp = await employeeForUser(userId);
  if (!emp) {
    return (
      <>
        <TopBar title="My Leave" />
        <div className="p-margin">
          <Section title="">
            <p className="py-lg text-center text-on-surface-variant">
              Your login isn&apos;t linked to an employee record yet. Ask HR to link your account from
              the Employees page.
            </p>
          </Section>
        </div>
      </>
    );
  }
  const requests = await prisma.hrLeaveRequest.findMany({
    where: { employeeId: emp.id },
    orderBy: { fromDate: "desc" },
    take: 100,
    include: { reviewedBy: { select: { username: true } } },
  });
  const bal = emp.leaveBalances[0];
  // Owners (MD / Director) have no leave — show history only, no apply form.
  const canApply = !(isOwnerDesignation(emp.designationRef?.name) || isOwnerDesignation(emp.designation));
  const ledgerYear = new Date().getUTCFullYear();
  const ledger = canApply
    ? await computeMonthlyLeaveLedger(emp.id, ledgerYear)
    : { rows: [], opening: 0 };
  return (
    <>
      <TopBar
        title="My Leave"
        subtitle={
          bal ? `Balance: ${Number(bal.balance).toFixed(1)} · Used: ${Number(bal.used).toFixed(1)}` : "No balance yet"
        }
      />
      <div className="p-margin">
        <MyLeaveClient
          ledgerYear={ledgerYear}
          ledgerOpening={ledger.opening}
          ledger={ledger.rows}
          balance={
            bal
              ? {
                  year: bal.year,
                  opening: Number(bal.opening),
                  accrued: Number(bal.accrued),
                  used: Number(bal.used),
                  balance: Number(bal.balance),
                }
              : null
          }
          requests={requests.map((r) => ({
            id: r.id,
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
        />
      </div>
    </>
  );
}
