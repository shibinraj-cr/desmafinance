import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { employeeForUser } from "@/lib/hr-me";
import { isOwnerDesignation } from "@/lib/hr-salary-engine";
import { computeMonthlyLeaveLedger, recomputeLeaveBalance } from "@/lib/hr-leave-balance";
import { halfSessionLabel } from "@/lib/hr-regularization";
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
  // The employee's own leave requests. These used to be read from
  // HrLeaveRequest, the retired table nothing writes to, so this list was empty
  // even for someone who had just filed — they could not tell whether their
  // request had landed. Read the live source instead.
  const requests = await prisma.hrAttendanceRegularization.findMany({
    where: { employeeId: emp.id, requestType: "leave" },
    orderBy: { date: "desc" },
    take: 100,
  });
  // Refresh before reading. The stored HrLeaveBalance row is only rewritten on
  // a leave/attendance decision, so an employee with no recent activity saw a
  // months-old headline sitting directly above a live ledger that disagreed
  // with it. /hr/leave-balances already recomputes on load; this matches it.
  const balanceYear = new Date().getUTCFullYear();
  const bal = await recomputeLeaveBalance(emp.id, balanceYear);
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
        subtitle={`Balance: ${bal.balance.toFixed(1)} · Used: ${bal.used.toFixed(1)}`}
      />
      <div className="p-margin">
        <MyLeaveClient
          ledgerYear={ledgerYear}
          ledgerOpening={ledger.opening}
          ledger={ledger.rows}
          balance={{
            year: balanceYear,
            opening: bal.opening,
            accrued: bal.accrued,
            used: bal.used,
            balance: bal.balance,
          }}
          requests={requests.map((r) => {
            const iso = r.date.toISOString().slice(0, 10);
            const half = halfSessionLabel(r.halfSession);
            return {
              id: r.id,
              // A leave request covers a single date until multi-day requests
              // land; from and to are the same day.
              fromDate: iso,
              toDate: iso,
              days: r.halfSession ? 0.5 : 1,
              leaveType: half ?? "Full day",
              reason: r.reason,
              status: r.status,
              reviewedBy: null,
              reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
              reviewNote: r.reviewNote,
            };
          })}
        />
      </div>
    </>
  );
}
