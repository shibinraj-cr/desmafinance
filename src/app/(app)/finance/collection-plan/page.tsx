import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { TopBar } from "@/components/TopBar";
import { inr } from "@/lib/format";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

function statusBadge(s: string): { label: string; cls: string } {
  switch (s) {
    case "received":
      return { label: "Received", cls: "bg-green-100 text-green-800" };
    case "submitted":
      return { label: "Submitted", cls: "bg-amber-100 text-amber-800" };
    case "cancelled":
      return { label: "Cancelled", cls: "bg-surface-container text-on-surface-variant" };
    default:
      return { label: "Pending", cls: "bg-blue-100 text-blue-800" };
  }
}

export default async function CollectionPlanListPage() {
  const { perms } = await getCurrentUserAndPermissions();
  if (!perms) redirect("/login");

  const plans = await prisma.collectionPlan.findMany({
    orderBy: [{ createdAt: "desc" }],
    include: {
      party: { select: { id: true, name: true } },
      service: { select: { id: true, name: true } },
      installments: { orderBy: { seq: "asc" } },
    },
  });

  const rows = plans.map((p) => {
    const total = p.installments.reduce((s, i) => s + Number(i.amount.toString()), 0);
    const received = p.installments
      .filter((i) => i.status === "received")
      .reduce((s, i) => s + Number(i.amount.toString()), 0);
    const submitted = p.installments
      .filter((i) => i.status === "submitted")
      .reduce((s, i) => s + Number(i.amount.toString()), 0);
    const pending = p.installments
      .filter((i) => i.status === "pending")
      .reduce((s, i) => s + Number(i.amount.toString()), 0);
    return { plan: p, total, received, submitted, pending };
  });

  const summary = {
    plans: plans.length,
    totalExpected: rows.reduce((s, r) => s + r.total, 0),
    totalReceived: rows.reduce((s, r) => s + r.received, 0),
    totalSubmitted: rows.reduce((s, r) => s + r.submitted, 0),
    totalPending: rows.reduce((s, r) => s + r.pending, 0),
  };

  return (
    <>
      <TopBar
        title="Collection Plans"
        subtitle={`${summary.plans} plan${summary.plans === 1 ? "" : "s"}`}
        action={
          <Link
            href="/finance/collection-plan/new"
            className="px-md py-sm bg-primary text-on-primary rounded-md text-body-md font-semibold hover:opacity-90"
          >
            + New Plan
          </Link>
        }
      />
      <div className="p-margin space-y-lg">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
          <Tile label="Expected" value={summary.totalExpected} />
          <Tile label="Received" value={summary.totalReceived} tone="success" />
          <Tile label="Awaiting Approval" value={summary.totalSubmitted} tone="warning" />
          <Tile label="Pending Submission" value={summary.totalPending} tone="info" />
        </section>

        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl overflow-hidden">
          {rows.length === 0 ? (
            <div className="p-xl text-center text-on-surface-variant">
              No collection plans yet. Start one for an upcoming candidate
              receivable.
            </div>
          ) : (
            <div className="max-h-[calc(100vh-300px)] overflow-auto">
              <table className="w-full text-body-md">
                <thead className="sticky top-0 bg-surface-container-low z-10">
                  <tr className="text-left text-caption text-on-surface-variant uppercase tracking-wide">
                    <th className="px-md py-sm">Candidate</th>
                    <th className="px-md py-sm">Plan</th>
                    <th className="px-md py-sm">Service</th>
                    <th className="px-md py-sm text-right">Installments</th>
                    <th className="px-md py-sm text-right">Total</th>
                    <th className="px-md py-sm text-right">Received</th>
                    <th className="px-md py-sm">Status</th>
                    <th className="px-md py-sm"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ plan, total, received }) => {
                    const nextDue = plan.installments.find(
                      (i) => i.status === "pending" || i.status === "submitted",
                    );
                    return (
                      <tr
                        key={plan.id}
                        className="border-t border-outline-variant hover:bg-surface-container-low"
                      >
                        <td className="px-md py-sm whitespace-nowrap">
                          <Link
                            href={`/finance/parties/${plan.partyId}`}
                            className="text-primary hover:underline"
                          >
                            {plan.party.name}
                          </Link>
                        </td>
                        <td className="px-md py-sm">{plan.label}</td>
                        <td className="px-md py-sm whitespace-nowrap text-on-surface-variant">
                          {plan.service?.name ?? "—"}
                        </td>
                        <td className="px-md py-sm text-right whitespace-nowrap">
                          {plan.installments.filter((i) => i.status === "received").length}/
                          {plan.installments.length}
                        </td>
                        <td className="px-md py-sm text-right whitespace-nowrap font-semibold">
                          {inr(total)}
                        </td>
                        <td className="px-md py-sm text-right whitespace-nowrap text-green-700">
                          {inr(received)}
                        </td>
                        <td className="px-md py-sm whitespace-nowrap">
                          {nextDue ? (
                            <span className="text-caption text-on-surface-variant">
                              Next: {fmtDate(nextDue.expectedDate)}{" "}
                              <span
                                className={
                                  "inline-block px-xs py-0.5 rounded-md text-xs font-medium ml-1 " +
                                  statusBadge(nextDue.status).cls
                                }
                              >
                                {statusBadge(nextDue.status).label}
                              </span>
                            </span>
                          ) : (
                            <span className="text-green-700 text-caption">Complete</span>
                          )}
                        </td>
                        <td className="px-md py-sm text-right whitespace-nowrap">
                          <Link
                            href={`/finance/collection-plan/${plan.id}`}
                            className="text-primary hover:underline"
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "info";
}) {
  const valueCls =
    tone === "success"
      ? "text-green-700"
      : tone === "warning"
        ? "text-amber-700"
        : tone === "info"
          ? "text-accent"
          : "text-on-surface";
  return (
    <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-xl shadow-sm">
      <div className="text-caption text-on-surface-variant uppercase tracking-wide">
        {label}
      </div>
      <div className={"text-h2 font-extrabold mt-xs " + valueCls}>{inr(value)}</div>
    </div>
  );
}
