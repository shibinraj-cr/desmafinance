import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { prisma } from "@/lib/prisma";
import { inrFull } from "@/lib/format";
import { canApprove } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { ApprovalActions } from "../actions";
import { ResubmitEditor } from "../resubmit-editor";
import { PendingList, type PendingRow, type PartyLookup } from "../pending-list";
import { Tabs } from "../_tabs";

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
type TypeFilter = "all" | "Revenue" | "Expense";

// Drafts only matter for users with the draftFirst flag (currently Ganga).
// Reviewers never see the tab.

/** YYYY-MM-DD (or ISO) → DD-MM-YY for display. */
function fmtDDMMYY(s: string): string {
  if (!s) return "—";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const [, y, mm, dd] = m;
  return `${dd}-${mm}-${y.slice(2)}`;
}

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;

export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: { tab: string };
  searchParams: {
    type?: string;
    /** Event-date range filter — applied client-side to the JSON-stored proposed date. */
    from?: string;
    to?: string;
    /** Party id filter. */
    party?: string;
  };
}) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  const reviewer = canApprove(perms);
  const tabRaw = params.tab;
  if (tabRaw !== "pending" && tabRaw !== "approved" && tabRaw !== "rejected") {
    notFound();
  }
  const tab: TabKey = tabRaw;
  const typeFilter: TypeFilter =
    searchParams.type === "Revenue" || searchParams.type === "Expense"
      ? (searchParams.type as TypeFilter)
      : "all";
  const fromDate = searchParams.from && DATE_RX.test(searchParams.from) ? searchParams.from : "";
  const toDate = searchParams.to && DATE_RX.test(searchParams.to) ? searchParams.to : "";
  const partyFilter = searchParams.party && searchParams.party.length > 0 ? searchParams.party : "";

  // Visibility: reviewers (manager/admin) see everyone's items, executives
  // see only their own submissions. The status filter narrows to the tab.
  const ownershipWhere = reviewer ? {} : { submittedById: userId ?? "__none__" };

  const [items, counts, masters, draftsCount] = await Promise.all([
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
    // Categories stay tab-specific (only the rejected resubmit flow
    // needs them), but parties are now always loaded so the DiffCard
    // can resolve `partyId` → friendly "Name (Group)" for reviewers
    // in every tab.
    Promise.all([
      tab === "rejected"
        ? prisma.category.findMany({
            orderBy: [{ type: "asc" }, { name: "asc" }],
            include: {
              subItems: {
                orderBy: { name: "asc" },
                select: { id: true, name: true, isActive: true },
              },
            },
          })
        : Promise.resolve([] as {
            id: string;
            name: string;
            type: string;
            isActive: boolean;
            subItems: { id: string; name: string; isActive: boolean }[];
          }[]),
      prisma.party.findMany({
        orderBy: [{ group: "asc" }, { name: "asc" }],
        select: { id: true, name: true, group: true, txTypes: true, isActive: true },
      }),
    ]),
    // Draft tab counts:
    //   - draftFirst users: count of their own drafts
    //   - admins (without draftFirst): count of every draft in the
    //     system, since they oversee the queue
    //   - everyone else: hidden (count of 0 doesn't matter, tab not rendered)
    perms?.draftFirst && userId
      ? prisma.transactionDraft.count({ where: { submittedById: userId } })
      : perms?.isAdmin
        ? prisma.transactionDraft.count()
        : Promise.resolve(0),
  ]);

  const [pendingCount, approvedCount, rejectedCount] = counts;
  const [categories, parties] = masters;
  const partyById = new Map(parties.map((pt) => [pt.id, pt]));
  // Lookup shape consumed by the new list-view client component.
  const partyLookup: PartyLookup = Object.fromEntries(
    parties.map((pt) => [pt.id, { name: pt.name, group: pt.group }]),
  );

  // Effective transaction type for each PendingApproval row — read from
  // the proposed JSON for create/update, from the target tx for delete.
  function effectiveType(p: (typeof items)[number]): string {
    const proposed = p.proposed as unknown as ProposedTx | null;
    if (p.kind === "delete") return p.targetTx?.type ?? "";
    return proposed?.type ?? p.targetTx?.type ?? "";
  }
  /** YYYY-MM-DD event date from either proposed or targetTx. */
  function effectiveDate(p: (typeof items)[number]): string {
    const proposed = p.proposed as unknown as ProposedTx | null;
    if (p.kind === "delete") return p.targetTx?.date.toISOString().slice(0, 10) ?? "";
    return (
      (typeof proposed?.date === "string" ? proposed.date.slice(0, 10) : null) ??
      p.targetTx?.date.toISOString().slice(0, 10) ??
      ""
    );
  }
  /** Party id from either proposed or targetTx. */
  function effectivePartyId(p: (typeof items)[number]): string | null {
    const proposed = p.proposed as unknown as ProposedTx | null;
    if (p.kind === "delete") return p.targetTx?.partyId ?? null;
    return proposed?.partyId ?? p.targetTx?.partyId ?? null;
  }
  const typeCounts = {
    all: items.length,
    Revenue: items.filter((p) => effectiveType(p) === "Revenue").length,
    Expense: items.filter((p) => effectiveType(p) === "Expense").length,
  };
  // Type filter applies first (drives the chip counts), then the
  // From / To / Party filters narrow the visible rows.
  const filteredItems = items
    .filter((p) => (typeFilter === "all" ? true : effectiveType(p) === typeFilter))
    .filter((p) => {
      if (!fromDate && !toDate) return true;
      const d = effectiveDate(p);
      if (!d) return false;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
      return true;
    })
    .filter((p) => (partyFilter ? effectivePartyId(p) === partyFilter : true));

  const isReviewerPending = tab === "pending" && reviewer;
  const pendingRows: PendingRow[] = isReviewerPending
    ? filteredItems.map((p) => {
        const proposed = (p.proposed as unknown as ProposedTx | null) ?? null;
        // create/update show the proposed values; delete shows what is
        // about to be removed.
        const src: Partial<ProposedTx> & { partyId?: string | null } =
          p.kind === "delete" && p.targetTx
            ? {
                date: p.targetTx.date.toISOString().slice(0, 10),
                type: p.targetTx.type,
                category: p.targetTx.category,
                subItem: p.targetTx.subItem,
                partyId: p.targetTx.partyId,
                description: p.targetTx.description,
                paymentMode: p.targetTx.paymentMode,
                flow: p.targetTx.flow,
                amount: Number(p.targetTx.amount.toString()),
              }
            : proposed ?? {};
        return {
          id: p.id,
          kind: p.kind as PendingRow["kind"],
          submittedBy: p.submittedBy?.username ?? "(deleted user)",
          createdAt: p.createdAt.toISOString(),
          date: typeof src.date === "string" ? src.date.slice(0, 10) : "",
          type: src.type ?? "",
          category: src.category ?? "",
          subItem: src.subItem ?? "",
          partyId: src.partyId ?? null,
          description: src.description ?? null,
          paymentMode: src.paymentMode ?? "",
          flow: src.flow ?? "",
          amount: typeof src.amount === "number" ? src.amount : Number(src.amount ?? 0),
        };
      })
    : [];
  const totalShown = filteredItems.length;
  const tabSubtitle =
    tab === "pending"
      ? `${totalShown} pending`
      : tab === "approved"
        ? `${totalShown} approved`
        : `${totalShown} rejected · resubmit or dismiss to clear from queue`;

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
          myDrafts={
            perms?.draftFirst || perms?.isAdmin ? { count: draftsCount } : undefined
          }
          preserve={{
            type: typeFilter,
            from: fromDate,
            to: toDate,
            party: partyFilter,
          }}
        />

        <TypeTabs
          tab={tab}
          active={typeFilter}
          counts={typeCounts}
          fromDate={fromDate}
          toDate={toDate}
          partyFilter={partyFilter}
        />

        <DateAndPartyFilter
          tab={tab}
          typeFilter={typeFilter}
          fromDate={fromDate}
          toDate={toDate}
          partyFilter={partyFilter}
          parties={parties}
        />

        {isReviewerPending ? (
          <PendingList rows={pendingRows} partyById={partyLookup} />
        ) : filteredItems.length === 0 ? (
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
          filteredItems.map((p) => {
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
                    {fmtDDMMYY(p.createdAt.toISOString())}
                  </span>
                </div>

                {p.kind === "delete" && before && (
                  <DiffCard before={before} after={null} partyById={partyById} />
                )}
                {p.kind === "create" && proposed && (
                  <DiffCard before={null} after={proposed} partyById={partyById} />
                )}
                {p.kind === "update" && (
                  <DiffCard before={before} after={proposed} partyById={partyById} />
                )}

                {p.reviewNote && (
                  <div className="rounded-lg bg-surface-container-low px-md py-sm text-body-md text-on-surface-variant">
                    <strong>Note:</strong> {p.reviewNote}
                  </div>
                )}
                {p.reviewedBy && p.reviewedAt && (
                  <p className="text-caption text-on-surface-variant">
                    Reviewed by <strong>{p.reviewedBy.username}</strong> on{" "}
                    {fmtDDMMYY(p.reviewedAt.toISOString())}
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

/** Secondary filter row inside each tab — All / Revenue / Expense. */
/** Inline form with From / To date inputs + Party dropdown. Submits
 *  GET to the same /finance/approvals/[tab] route — hidden inputs
 *  carry the active type filter so the user's tab state is preserved
 *  through the Apply click. Per the date+party filters being applied
 *  in JS, swapping them is a pure URL change; no server route
 *  changes needed. */
function DateAndPartyFilter({
  tab,
  typeFilter,
  fromDate,
  toDate,
  partyFilter,
  parties,
}: {
  tab: TabKey;
  typeFilter: TypeFilter;
  fromDate: string;
  toDate: string;
  partyFilter: string;
  parties: Array<{ id: string; name: string; group: string; isActive: boolean }>;
}) {
  const hasAnyFilter = !!fromDate || !!toDate || !!partyFilter;
  const clearHref =
    typeFilter === "all" ? `/finance/approvals/${tab}` : `/finance/approvals/${tab}?type=${typeFilter}`;
  return (
    <form
      action={`/finance/approvals/${tab}`}
      method="get"
      className="flex flex-wrap items-end gap-sm rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm"
    >
      {typeFilter !== "all" && <input type="hidden" name="type" value={typeFilter} />}
      <label className="flex flex-col gap-[2px] text-caption text-on-surface-variant">
        <span className="uppercase tracking-wider font-semibold">From</span>
        <input
          type="date"
          name="from"
          defaultValue={fromDate}
          className="h-9 px-sm rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md"
        />
      </label>
      <label className="flex flex-col gap-[2px] text-caption text-on-surface-variant">
        <span className="uppercase tracking-wider font-semibold">To</span>
        <input
          type="date"
          name="to"
          defaultValue={toDate}
          className="h-9 px-sm rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md"
        />
      </label>
      <label className="flex flex-col gap-[2px] text-caption text-on-surface-variant">
        <span className="uppercase tracking-wider font-semibold">Party</span>
        <select
          name="party"
          defaultValue={partyFilter}
          className="h-9 px-sm rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md min-w-[200px]"
        >
          <option value="">All parties</option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.group}){p.isActive ? "" : " — inactive"}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-xs ml-auto">
        <button
          type="submit"
          className="h-9 px-md rounded-md bg-primary text-on-primary text-label-sm font-semibold hover:opacity-90 transition"
        >
          Apply
        </button>
        {hasAnyFilter && (
          <Link
            href={clearHref}
            className="h-9 inline-flex items-center px-md rounded-md border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:text-on-surface transition"
            scroll={false}
          >
            Clear
          </Link>
        )}
      </div>
    </form>
  );
}

function TypeTabs({
  tab,
  active,
  counts,
  fromDate,
  toDate,
  partyFilter,
}: {
  tab: TabKey;
  active: TypeFilter;
  counts: { all: number; Revenue: number; Expense: number };
  fromDate: string;
  toDate: string;
  partyFilter: string;
}) {
  const items: Array<{ key: TypeFilter; label: string; count: number }> = [
    { key: "all", label: "All", count: counts.all },
    { key: "Revenue", label: "Revenue", count: counts.Revenue },
    { key: "Expense", label: "Expense", count: counts.Expense },
  ];
  function buildHref(key: TypeFilter): string {
    const qs = new URLSearchParams();
    if (key !== "all") qs.set("type", key);
    if (fromDate) qs.set("from", fromDate);
    if (toDate) qs.set("to", toDate);
    if (partyFilter) qs.set("party", partyFilter);
    const q = qs.toString();
    return q ? `/finance/approvals/${tab}?${q}` : `/finance/approvals/${tab}`;
  }
  return (
    <div className="flex flex-wrap items-center gap-xs">
      <span className="text-caption text-on-surface-variant mr-xs uppercase tracking-wider font-semibold">
        Filter
      </span>
      {items.map((t) => {
        const isActive = active === t.key;
        const href = buildHref(t.key);
        return (
          <Link
            key={t.key}
            href={href}
            scroll={false}
            className={
              "inline-flex items-center gap-xs h-8 px-sm rounded-full border text-label-sm font-semibold transition " +
              (isActive
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:text-on-surface")
            }
          >
            <span>{t.label}</span>
            <span
              className={
                "text-[11px] font-bold px-xs py-[1px] rounded-full min-w-[20px] text-center " +
                (isActive
                  ? "bg-on-primary text-primary"
                  : "bg-surface-container-low text-on-surface-variant")
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

type DiffField = {
  key: keyof ProposedTx;
  label: string;
};

function DiffCard({
  before,
  after,
  partyById,
}: {
  before: ProposedTx | null;
  after: ProposedTx | null;
  partyById: Map<string, { id: string; name: string; group: string }>;
}) {
  const fields: DiffField[] = [
    { key: "date", label: "Date" },
    { key: "month", label: "Month" },
    { key: "type", label: "Type" },
    { key: "category", label: "Category" },
    { key: "subItem", label: "Sub-item" },
    { key: "partyId", label: "Party" },
    { key: "description", label: "Description" },
    { key: "paymentMode", label: "Payment mode" },
    { key: "flow", label: "Flow" },
    { key: "amount", label: "Total amount" },
  ];
  const renderPartyId = (id: unknown) => {
    if (id === null || id === undefined || id === "") return "—";
    const p = partyById.get(String(id));
    return p ? `${p.name} (${p.group})` : `(deleted party: ${String(id).slice(0, 8)})`;
  };
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
            const b = before?.[f.key];
            const a = after?.[f.key];
            const changed = String(b ?? "") !== String(a ?? "");
            const fmt = (v: unknown) => {
              if (v === null || v === undefined || v === "") return "—";
              if (f.key === "partyId") return renderPartyId(v);
              if (f.key === "amount") return inrFull(Number(v));
              if (f.key === "date" && typeof v === "string") return fmtDDMMYY(v);
              return String(v);
            };
            return (
              <tr
                key={f.key}
                className={
                  "border-t border-outline-variant/60 " + (changed ? "bg-amber-50/40" : "")
                }
              >
                <td className="px-md py-sm text-on-surface-variant">{f.label}</td>
                <td className="px-md py-sm font-mono">{fmt(b)}</td>
                <td
                  className={"px-md py-sm font-mono " + (changed ? "font-semibold text-on-surface" : "")}
                >
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
