import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { isHrUser, canApproveHr } from "@/lib/hr-rbac";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { REGULARIZATION_REASONS } from "@/lib/hr-regularization";
import { loadLeaveReview } from "@/lib/hr-leave-review";
import { RegularizationReviewClient } from "./client";
import { LeaveDecisionsClient } from "./leave-decisions-client";

export const dynamic = "force-dynamic";

export default async function RegularizationReviewPage({
  searchParams,
}: {
  searchParams?: { status?: string; tab?: string; month?: string };
}) {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");
  if (!isHrUser(perms)) {
    return (
      <>
        <TopBar title="Attendance Corrections" />
        <div className="p-margin">
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">No access.</div>
          </Section>
        </div>
      </>
    );
  }

  const tab = searchParams?.tab === "leave" ? "leave" : "requests";
  const canDecide = canApproveHr(perms);

  // Pending-request count drives the tab badge regardless of which tab is active.
  const pendingCount = await prisma.hrAttendanceRegularization.count({ where: { status: "pending" } });

  const TabBar = (
    <div className="flex items-center gap-xs border-b border-outline-variant">
      {(
        [
          { key: "requests", label: "Punch Requests", href: "/hr/regularization?tab=requests" },
          { key: "leave", label: "Leave Decisions", href: "/hr/regularization?tab=leave" },
        ] as const
      ).map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={
            "px-md py-sm text-label-sm -mb-px border-b-2 " +
            (tab === t.key
              ? "border-primary text-primary font-bold"
              : "border-transparent text-on-surface-variant")
          }
        >
          {t.label}
          {t.key === "requests" && pendingCount > 0 ? (
            <span className="ml-xs rounded-full bg-yellow-100 text-yellow-800 text-caption px-xs">
              {pendingCount}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );

  if (tab === "leave") {
    const data = await loadLeaveReview(searchParams?.month);
    return (
      <>
        <TopBar
          title="Attendance Corrections"
          subtitle={`Leave decisions · ${data.cycleLabel} · ${data.totalUndecided} undecided`}
        />
        <div className="p-margin space-y-lg">
          {TabBar}
          <LeaveDecisionsClient
            monthKey={data.requested}
            prevMonth={data.prevMonth}
            nextMonth={data.nextMonth}
            cycleLabel={data.cycleLabel}
            groups={data.groups}
            canDecide={canDecide}
          />
        </div>
      </>
    );
  }

  const status = searchParams?.status ?? "pending";
  const [requests, counts] = await Promise.all([
    prisma.hrAttendanceRegularization.findMany({
      where: { status },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: { employee: { select: { empCode: true, name: true } } },
    }),
    prisma.hrAttendanceRegularization.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const tally = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const reasonLabel = Object.fromEntries(REGULARIZATION_REASONS.map((r) => [r.code, r.label]));
  return (
    <>
      <TopBar
        title="Attendance Corrections"
        subtitle={`Punch requests · Pending ${tally.pending ?? 0} · Approved ${tally.approved ?? 0} · Rejected ${tally.rejected ?? 0}`}
      />
      <div className="p-margin space-y-lg">
        {TabBar}
        <RegularizationReviewClient
          canDecide={canDecide}
          status={status}
          requests={requests.map((r) => ({
            id: r.id,
            empCode: r.employee.empCode,
            name: r.employee.name,
            date: r.date.toISOString().slice(0, 10),
            reasonType: r.reasonType,
            reasonLabel: reasonLabel[r.reasonType] ?? r.reasonType,
            reason: r.reason,
            proposedIn: r.proposedIn,
            proposedOut: r.proposedOut,
            status: r.status,
            attachmentUrl: r.attachmentUrl,
            createdAt: r.createdAt.toISOString(),
            reviewNote: r.reviewNote,
          }))}
        />
      </div>
    </>
  );
}
