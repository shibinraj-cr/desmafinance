import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { prisma } from "@/lib/prisma";
import { inrFull } from "@/lib/format";
import { canApprove } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { ApprovalActions } from "./actions";
import { ResubmitEditor } from "./resubmit-editor";

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
  partyId?: string | null;
};

type TabKey = "pending" | "approved" | "rejected";

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  const reviewer = canApprove(perms);
  const tab: TabKey =
    searchParams.tab === "approved" || searchParams.tab === "rejected"
      ? searchParams.tab
      : "pending";

  // Visibility: reviewers (manager/admin) see everyone's items, executives
  // see only their own submissions. The status filter narrows to the tab.
  const ownershipWhere = reviewer ? {} : { submittedById: userId ?? "__none__" };

  const [items, counts, masters] = await Promise.all([
    prisma.pendingApproval.findMany({
      where: { ...ownershipWhere, status: tab },
      include: {
        submittedBy: { select: { id: true, username: true, role: true } },
        reviewedBy: { select: { id: true, username: true } },
        targetTx: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    }),
    Promise.all([
      prisma.pendingApproval.count({ where: { ...ownershipWhere, status: "pending" } }),
      prisma.pendingApproval.count({ where: { ...ownershipWhere, status: "approved" } }),
      prisma.pendingApproval.count({ where: { ...ownershipWhere, status: "rejected" } }),
    ]),
    // Master data needed by ResubmitEditor (categories + parties).
    // Skipped for reviewers since they don't resubmit.
    tab === "rejected"
      ? Promise.all([
          prisma.category.findMany({
            orderBy: [{ type: "asc" }, { name: "asc" }],
            include: {
              subItems: {
                orderBy: { name: "asc" },
                select: { id: true, name: true, isActive: true },
              },
            },
          }),
          prisma.party.findMany({
            where: { isActive: true },
            orderBy: [{ group: "asc" }, { name: "asc" }],
            select: { id: true, name: true, group: true, txTypes: true, isActive: true },
          }),
        ])
      : Promise.resolve([[], []] as [
          {
            id: string;
            name: string;
            type: string;
            isActive: boolean;
            subItems: { id: string; name: string; isActive: boolean }[];
          }[],
          { id: string; name: string; group: string; txTypes: string; isActive: boolean }[],
        ]),
  ]);

  const [pendingCount, approvedCount, rejectedCount] = counts;
  const [categories, parties] = masters;
  const tabSubtitle =
    tab === "pending"
      ? `${items.length} pending`
      : tab === "approved"
        ? `${items.length} approved`
        : `${items.length} rejected · resubmit or dismiss to clear from queue`;

  return (
    <>
      <TopBar
        title="Approvals"
        subtitle={reviewer ? tabSubtitle : `Your submissions · ${tabSubtitle}`}
      />
      <div className="p-margin space-y-lg">
        <Tabs
          active={tab}
          counts={{ pending: pendingCount, approved: approvedCount, rejected: rejectedCount }}
        />

        {items.length === 0 ? (
          <Section title="">
            <div className="py-lg text-center text-on-surface-variant">
              {tab === "pending"
                ? reviewer
                  ? "No pending approvals."
                  : "You haven't submitted any pending changes."
                : tab === "approved"
                  ? reviewer
                    ? "Nothing approved in the recent window."
                    : "None of your changes have been approved yet."
                  : reviewer
                    ? "Nothing rejected yet."
                    : "None of your changes have been rejected."}
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
                  partyId: p.targetTx.partyId,
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

            const isOwner = p.submittedById === userId;
            const canResubmit = p.status === "rejected" && isOwner;

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

                {canResubmit && (
                  <ResubmitEditor
                    pendingId={p.id}
                    kind={p.kind as "create" | "update" | "delete"}
                    initialProposed={proposed ?? before}
                    categories={categories.map((c) => ({
                      id: c.id,
                      name: c.name,
                      type: c.type as "Revenue" | "Expense" | "Both",
                      isActive: c.isActive,
                      subItems: c.subItems,
                    }))}
                    parties={parties.map((pt) => ({
                      id: pt.id,
                      name: pt.name,
                      group: pt.group as "Candidate" | "Vendor",
                      txTypes: pt.txTypes as "Revenue" | "Expense" | "Both",
                      isActive: pt.isActive,
                    }))}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function Tabs({
  active,
  counts,
}: {
  active: TabKey;
  counts: { pending: number; approved: number; rejected: number };
}) {
  const tabs: Array<{
    key: TabKey;
    label: string;
    count: number;
    countTone: "amber" | "green" | "red";
  }> = [
    { key: "pending", label: "Pending", count: counts.pending, countTone: "amber" },
    { key: "approved", label: "Approved", count: counts.approved, countTone: "green" },
    { key: "rejected", label: "Rejected", count: counts.rejected, countTone: "red" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-xs border-b border-outline-variant">
      {tabs.map((t) => {
        const activeStyles =
          active === t.key
            ? "text-on-surface font-semibold border-primary"
            : "text-on-surface-variant border-transparent hover:text-on-surface";
        const countStyles =
          t.countTone === "amber"
            ? "bg-amber-50 text-amber-800"
            : t.countTone === "green"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700";
        return (
          <Link
            key={t.key}
            href={t.key === "pending" ? "/finance/approvals" : `/finance/approvals?tab=${t.key}`}
            scroll={false}
            className={
              "inline-flex items-center gap-xs h-10 px-md border-b-2 transition " + activeStyles
            }
          >
            <span>{t.label}</span>
            <span
              className={
                "text-[11px] font-bold px-xs py-[1px] rounded-full min-w-[20px] text-center " +
                countStyles
              }
            >
              {t.count}
            </span>
          </Link>
        );
      })}
    </div>
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
