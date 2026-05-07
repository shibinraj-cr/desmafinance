import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { prisma } from "@/lib/prisma";
import { inrFull } from "@/lib/format";
import { canApprove } from "@/lib/rbac";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ApprovalActions } from "./actions";

export const dynamic = "force-dynamic";

type ProposedTx = {
  date: string;
  month: string;
  type: string;
  category: string;
  subItem: string;
  description?: string | null;
  paymentMode: string;
  amount: number;
  flow: string;
};

export default async function ApprovalsPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user.role ?? "executive";
  const userId = session?.user.id ?? "";
  const reviewer = canApprove(role);

  const where = reviewer ? { status: "pending" } : { submittedById: userId };

  const items = await prisma.pendingApproval.findMany({
    where,
    include: {
      submittedBy: { select: { id: true, username: true, role: true } },
      reviewedBy: { select: { id: true, username: true } },
      targetTx: true,
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return (
    <>
      <TopBar
        title="Approvals"
        subtitle={
          reviewer
            ? `${items.length} pending change${items.length === 1 ? "" : "s"}`
            : "Your submissions"
        }
      />
      <div className="p-margin space-y-lg">
        {items.length === 0 ? (
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              {reviewer ? "No pending approvals." : "You haven't submitted any changes yet."}
            </div>
          </Section>
        ) : (
          items.map((p) => {
            const proposed = (p.proposed as unknown as ProposedTx | null) ?? null;
            const before = p.targetTx
              ? {
                  date: p.targetTx.date.toISOString().slice(0, 10),
                  month: p.targetTx.month,
                  type: p.targetTx.type,
                  category: p.targetTx.category,
                  subItem: p.targetTx.subItem,
                  description: p.targetTx.description,
                  paymentMode: p.targetTx.paymentMode,
                  amount: Number(p.targetTx.amount.toString()),
                  flow: p.targetTx.flow,
                }
              : null;

            const kindLabel =
              p.kind === "create"
                ? "New transaction"
                : p.kind === "update"
                  ? "Edit transaction"
                  : "Delete transaction";

            const statusBadge =
              p.status === "approved"
                ? "bg-green-50 text-green-700 border-green-200"
                : p.status === "rejected"
                  ? "bg-red-50 text-red-700 border-red-200"
                  : "bg-amber-50 text-amber-800 border-amber-200";

            return (
              <div
                key={p.id}
                className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-lg space-y-md"
              >
                <div className="flex flex-wrap items-center gap-base">
                  <span className="text-h3 font-semibold text-on-surface">{kindLabel}</span>
                  <span
                    className={
                      "px-sm py-xs rounded-full border text-label-sm font-semibold uppercase tracking-wider " +
                      statusBadge
                    }
                  >
                    {p.status}
                  </span>
                  <span className="text-caption text-on-surface-variant ml-auto">
                    submitted by{" "}
                    <strong>{p.submittedBy?.username ?? "(deleted user)"}</strong> on{" "}
                    {p.createdAt.toISOString().slice(0, 10)}
                  </span>
                </div>

                {p.kind === "delete" && before && <DiffCard before={before} after={null} />}
                {p.kind === "create" && proposed && <DiffCard before={null} after={proposed} />}
                {p.kind === "update" && (
                  <DiffCard before={before} after={proposed} />
                )}

                {p.reviewNote && (
                  <div className="rounded-lg bg-surface-container-low px-md py-sm text-body-md text-on-surface-variant">
                    <strong>Note:</strong> {p.reviewNote}
                  </div>
                )}
                {p.reviewedBy && p.reviewedAt && (
                  <p className="text-caption text-on-surface-variant">
                    Reviewed by <strong>{p.reviewedBy.username}</strong> on{" "}
                    {p.reviewedAt.toISOString().slice(0, 10)}
                  </p>
                )}

                {reviewer && p.status === "pending" && <ApprovalActions id={p.id} />}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function DiffCard({
  before,
  after,
}: {
  before: ProposedTx | null;
  after: ProposedTx | null;
}) {
  const fields: Array<keyof ProposedTx> = [
    "date",
    "month",
    "type",
    "category",
    "subItem",
    "description",
    "paymentMode",
    "amount",
    "flow",
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-outline-variant">
      <table className="w-full text-body-md">
        <thead className="bg-surface-container-low text-on-surface-variant">
          <tr className="text-left">
            <th className="px-md py-sm text-label-sm uppercase">Field</th>
            <th className="px-md py-sm text-label-sm uppercase">Current</th>
            <th className="px-md py-sm text-label-sm uppercase">Proposed</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const b = before?.[f];
            const a = after?.[f];
            const changed = String(b ?? "") !== String(a ?? "");
            const fmt = (v: unknown) => {
              if (v === null || v === undefined) return "—";
              if (f === "amount") return inrFull(Number(v));
              if (f === "date" && typeof v === "string") return v.slice(0, 10);
              return String(v);
            };
            return (
              <tr key={f} className={"border-t border-outline-variant/60 " + (changed ? "bg-amber-50/40" : "")}>
                <td className="px-md py-sm text-on-surface-variant">{f}</td>
                <td className="px-md py-sm font-mono">{fmt(b)}</td>
                <td className={"px-md py-sm font-mono " + (changed ? "font-semibold text-on-surface" : "")}>
                  {fmt(a)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
