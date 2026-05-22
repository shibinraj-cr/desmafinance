import Link from "next/link";
import { prisma } from "@/lib/prisma";

function fmtDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

function statusBadge(s: string): { label: string; cls: string } {
  switch (s) {
    case "submitted":
      return { label: "Awaiting Approval", cls: "bg-amber-100 text-amber-800" };
    default:
      return { label: "Pending", cls: "bg-blue-100 text-blue-800" };
  }
}

/**
 * Server component: shows staged Collection Plan installments that
 * are still unpaid (pending or submitted) ordered by expected date.
 * Renders on the Finance Overview to give supervisors a quick read
 * on near-term receivables.
 */
export async function UpcomingCollections({ limit = 8 }: { limit?: number }) {
  const installments = await prisma.collectionPlanInstallment.findMany({
    where: { status: { in: ["pending", "submitted"] } },
    orderBy: [{ expectedDate: "asc" }],
    take: limit,
    include: {
      plan: {
        select: {
          id: true,
          label: true,
          party: { select: { id: true, name: true } },
          service: { select: { id: true, name: true } },
        },
      },
    },
  });

  const totalPending = await prisma.collectionPlanInstallment.aggregate({
    where: { status: { in: ["pending", "submitted"] } },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const totalExpected = totalPending._sum.amount
    ? Number(totalPending._sum.amount.toString())
    : 0;

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl">
      <div className="flex items-center justify-between p-md border-b border-outline-variant">
        <div>
          <h3 className="text-h3 font-bold">Upcoming Collections</h3>
          <div className="text-caption text-on-surface-variant">
            {totalPending._count._all} installment
            {totalPending._count._all === 1 ? "" : "s"} pending · ₹
            {totalExpected.toLocaleString("en-IN")} expected
          </div>
        </div>
        <Link
          href="/finance/collection-plan"
          className="text-body-md text-primary hover:underline"
        >
          All plans →
        </Link>
      </div>
      {installments.length === 0 ? (
        <p className="p-lg text-center text-on-surface-variant">
          No staged collections.
        </p>
      ) : (
        <div className="divide-y divide-outline-variant">
          {installments.map((i) => {
            const b = statusBadge(i.status);
            return (
              <div
                key={i.id}
                className="flex items-center justify-between gap-md p-md"
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate">
                    <Link
                      href={`/finance/collection-plan/${i.plan.id}`}
                      className="text-primary hover:underline"
                    >
                      {i.plan.party.name}
                    </Link>
                    <span className="text-on-surface-variant font-normal">
                      {" · "}
                      {i.plan.service?.name ?? i.plan.label}
                    </span>
                  </div>
                  <div className="text-caption text-on-surface-variant">
                    Expected {fmtDate(i.expectedDate)} · Installment #{i.seq}
                  </div>
                </div>
                <div className="flex items-center gap-md whitespace-nowrap">
                  <span
                    className={
                      "inline-block px-xs py-0.5 rounded-md text-xs font-medium " + b.cls
                    }
                  >
                    {b.label}
                  </span>
                  <div className="text-body-md font-semibold">
                    ₹{Number(i.amount.toString()).toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
