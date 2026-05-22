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

/** Server component: renders a "Collection Plans" card for the given
 *  party. Used on the candidate detail page so finance staff can see
 *  staged receivables alongside the candidate's actual transactions. */
export async function PartyCollectionPlans({ partyId }: { partyId: string }) {
  const plans = await prisma.collectionPlan.findMany({
    where: { partyId },
    orderBy: [{ createdAt: "desc" }],
    include: {
      installments: { orderBy: { seq: "asc" } },
      service: { select: { id: true, name: true } },
    },
  });

  if (plans.length === 0) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-h3 font-bold">Collection Plans</h3>
          <Link
            href={`/finance/collection-plan/new?partyId=${partyId}`}
            className="px-md py-sm bg-primary text-on-primary rounded-md text-body-md font-semibold hover:opacity-90"
          >
            + New plan
          </Link>
        </div>
        <p className="text-on-surface-variant text-body-md mt-md">
          No collection plans for this candidate yet.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl">
      <div className="flex items-center justify-between p-md border-b border-outline-variant">
        <h3 className="text-h3 font-bold">Collection Plans</h3>
        <Link
          href={`/finance/collection-plan/new?partyId=${partyId}`}
          className="px-md py-sm bg-primary text-on-primary rounded-md text-body-md font-semibold hover:opacity-90"
        >
          + New plan
        </Link>
      </div>
      <div className="divide-y divide-outline-variant">
        {plans.map((plan) => {
          const total = plan.installments.reduce(
            (s, i) => s + Number(i.amount.toString()),
            0,
          );
          const received = plan.installments
            .filter((i) => i.status === "received")
            .reduce((s, i) => s + Number(i.amount.toString()), 0);
          return (
            <div key={plan.id} className="p-md">
              <div className="flex items-baseline justify-between">
                <div>
                  <Link
                    href={`/finance/collection-plan/${plan.id}`}
                    className="text-primary hover:underline font-semibold"
                  >
                    {plan.label}
                  </Link>
                  <span className="ml-md text-caption text-on-surface-variant">
                    {plan.service?.name ?? plan.category} ·{" "}
                    {plan.installments.length} installment
                    {plan.installments.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="text-body-md whitespace-nowrap">
                  <span className="text-green-700 font-semibold">
                    ₹{received.toLocaleString("en-IN")}
                  </span>
                  <span className="text-on-surface-variant"> / </span>
                  <span className="font-semibold">₹{total.toLocaleString("en-IN")}</span>
                </div>
              </div>
              <div className="mt-sm overflow-auto">
                <table className="w-full text-body-md">
                  <thead>
                    <tr className="text-left text-caption text-on-surface-variant uppercase tracking-wide">
                      <th className="py-xs pr-md">#</th>
                      <th className="py-xs pr-md">Expected</th>
                      <th className="py-xs pr-md text-right">Amount</th>
                      <th className="py-xs pr-md">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.installments.map((i) => {
                      const b = statusBadge(i.status);
                      return (
                        <tr key={i.id} className="border-t border-outline-variant">
                          <td className="py-xs pr-md text-on-surface-variant">{i.seq}</td>
                          <td className="py-xs pr-md whitespace-nowrap">
                            {fmtDate(i.expectedDate)}
                          </td>
                          <td className="py-xs pr-md text-right whitespace-nowrap">
                            ₹{Number(i.amount.toString()).toLocaleString("en-IN")}
                          </td>
                          <td className="py-xs pr-md">
                            <span
                              className={
                                "inline-block px-xs py-0.5 rounded-md text-xs font-medium " +
                                b.cls
                              }
                            >
                              {b.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
