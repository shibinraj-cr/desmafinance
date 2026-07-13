import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Section } from "@/components/Cards";
import { prisma } from "@/lib/prisma";
import { inrFull } from "@/lib/format";
import { canApprove, canSeePage } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { ApprovalActions } from "../actions";
import { ResubmitEditor } from "../resubmit-editor";
import { PendingList, type PendingRow, type PartyLookup, type EmployeeLookup } from "../pending-list";
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
  employeeId?: string | null;
  expDom?: string | null;
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
    /** Category name filter (matches the proposed/targetTx `category` string). */
    category?: string;
    /** Payment mode filter (matches the proposed/targetTx `paymentMode` string). */
    payment?: string;
  };
}) {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) redirect("/login");
  if (!canSeePage(perms, "/finance/approvals")) redirect("/finance/overview");
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
  const categoryFilter = searchParams.category && searchParams.category.length > 0 ? searchParams.category : "";
  const paymentFilter = searchParams.payment && searchParams.payment.length > 0 ? searchParams.payment : "";

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
      // Active employees — needed so the rejected-row resubmit editor can
      // re-pick the employee counterparty on salary / incentive outflows.
      prisma.employee.findMany({
        where: { active: true },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          name: true,
          designation: true,
          designationRef: { select: { name: true } },
        },
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
  const [categories, parties, employeesRaw] = masters;
  const employees = employeesRaw.map((e) => ({
    id: e.id,
    name: e.name,
    designation: e.designationRef?.name ?? e.designation ?? null,
  }));
  const employeeById = new Map(employees.map((e) => [e.id, { id: e.id, name: e.name }]));
  const partyById = new Map(parties.map((pt) => [pt.id, pt]));
  // Lookup shape consumed by the new list-view client component.
  const partyLookup: PartyLookup = Object.fromEntries(
    parties.map((pt) => [pt.id, { name: pt.name, group: pt.group }]),
  );
  // Employee counterparties (salary / incentive outflows) so the pending
  // table can resolve `employeeId` → name, mirroring the party lookup.
  const employeeLookup: EmployeeLookup = Object.fromEntries(
    employees.map((e) => [e.id, { name: e.name }]),
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
  /** Category name from either proposed or targetTx. */
  function effectiveCategory(p: (typeof items)[number]): string {
    const proposed = p.proposed as unknown as ProposedTx | null;
    if (p.kind === "delete") return p.targetTx?.category ?? "";
    return proposed?.category ?? p.targetTx?.category ?? "";
  }
  /** Payment mode from either proposed or targetTx. */
  function effectivePaymentMode(p: (typeof items)[number]): string {
    const proposed = p.proposed as unknown as ProposedTx | null;
    if (p.kind === "delete") return p.targetTx?.paymentMode ?? "";
    return proposed?.paymentMode ?? p.targetTx?.paymentMode ?? "";
  }
  const typeCounts = {
    all: items.length,
    Revenue: items.filter((p) => effectiveType(p) === "Revenue").length,
    Expense: items.filter((p) => effectiveType(p) === "Expense").length,
  };
  // Type filter applies first (drives the chip counts), then the
  // From / To / Party / Category / Payment filters narrow the visible
  // rows.
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
    .filter((p) => (partyFilter ? effectivePartyId(p) === partyFilter : true))
    .filter((p) => (categoryFilter ? effectiveCategory(p) === categoryFilter : true))
    .filter((p) => (paymentFilter ? effectivePaymentMode(p) === paymentFilter : true));

  // Dropdown options for the Category / Payment selects — distinct
  // values seen in the current tab's items, narrowed by the active
  // type filter so reviewers only see relevant choices.
  const typeScoped = items.filter(
    (p) => typeFilter === "all" || effectiveType(p) === typeFilter,
  );
  const categoryOptions = Array.from(
    new Set(typeScoped.map((p) => effectiveCategory(p)).filter((s) => s.length > 0)),
  ).sort((a, b) => a.localeCompare(b));
  const paymentOptions = Array.from(
    new Set(typeScoped.map((p) => effectivePaymentMode(p)).filter((s) => s.length > 0)),
  ).sort((a, b) => a.localeCompare(b));

  /** Effective amount per pending row — `proposed.amount` for
   *  create/update, `targetTx.amount` for delete. */
  function effectiveAmount(p: (typeof items)[number]): number {
    const proposed = p.proposed as unknown as ProposedTx | null;
    if (p.kind === "delete") return p.targetTx ? Number(p.targetTx.amount.toString()) : 0;
    return typeof proposed?.amount === "number"
      ? proposed.amount
      : Number(proposed?.amount ?? 0);
  }
  // Filtered totals shown in the indicator chip — split by Revenue
  // and Expense so reviewers see the ₹ impact in each direction.
  let filteredRevenue = 0;
  let filteredExpense = 0;
  for (const p of filteredItems) {
    const amt = effectiveAmount(p);
    if (!Number.isFinite(amt)) continue;
    const t = effectiveType(p);
    if (t === "Revenue") filteredRevenue += amt;
    else if (t === "Expense") filteredExpense += amt;
  }
  const filteredCount = filteredItems.length;
  const filteredNet = filteredRevenue - filteredExpense;
  const hasActiveFilters =
    !!fromDate ||
    !!toDate ||
    !!partyFilter ||
    !!categoryFilter ||
    !!paymentFilter ||
    typeFilter !== "all";

  const isReviewerPending = tab === "pending" && reviewer;
  const pendingRows: PendingRow[] = isReviewerPending
    ? filteredItems.map((p) => {
        const proposed = (p.proposed as unknown as ProposedTx | null) ?? null;
        // create/update show the proposed values; delete shows what is
        // about to be removed.
        const src: Partial<ProposedTx> & { partyId?: string | null; expDom?: string | null } =
          p.kind === "delete" && p.targetTx
            ? {
                date: p.targetTx.date.toISOString().slice(0, 10),
                type: p.targetTx.type,
                category: p.targetTx.category,
                subItem: p.targetTx.subItem,
                partyId: p.targetTx.partyId,
                employeeId: p.targetTx.employeeId,
                description: p.targetTx.description,
                paymentMode: p.targetTx.paymentMode,
                flow: p.targetTx.flow,
                amount: Number(p.targetTx.amount.toString()),
                expDom: p.targetTx.expDom ?? null,
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
          employeeId: src.employeeId ?? null,
          description: src.description ?? null,
          paymentMode: src.paymentMode ?? "",
          flow: src.flow ?? "",
          amount: typeof src.amount === "number" ? src.amount : Number(src.amount ?? 0),
          expDom: src.expDom ?? null,
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
            category: categoryFilter,
            payment: paymentFilter,
          }}
        />

        <TypeTabs
          tab={tab}
          active={typeFilter}
          counts={typeCounts}
          fromDate={fromDate}
          toDate={toDate}
          partyFilter={partyFilter}
          categoryFilter={categoryFilter}
          paymentFilter={paymentFilter}
        />

        <DateAndPartyFilter
          tab={tab}
          typeFilter={typeFilter}
          fromDate={fromDate}
          toDate={toDate}
          partyFilter={partyFilter}
          categoryFilter={categoryFilter}
          paymentFilter={paymentFilter}
          parties={parties}
          categoryOptions={categoryOptions}
          paymentOptions={paymentOptions}
        />

        <FilteredTotals
          count={filteredCount}
          revenue={filteredRevenue}
          expense={filteredExpense}
          net={filteredNet}
          showAll={!hasActiveFilters}
        />

        {isReviewerPending ? (
          <PendingList rows={pendingRows} partyById={partyLookup} employeeById={employeeLookup} />
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
                  employeeId: p.targetTx.employeeId,
                  expDom: p.targetTx.expDom ?? null,
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
                  <DiffCard before={before} after={null} partyById={partyById} employeeById={employeeById} />
                )}
                {p.kind === "create" && proposed && (
                  <DiffCard before={null} after={proposed} partyById={partyById} employeeById={employeeById} />
                )}
                {p.kind === "update" && (
                  <DiffCard before={before} after={proposed} partyById={partyById} employeeById={employeeById} />
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
                    employees={employees}
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
/** Slim stat strip showing ₹ totals for whatever the active filters
 *  show. Sits between the filter form and the queue list so reviewers
 *  see the financial impact of the current view at a glance. */
function FilteredTotals({
  count,
  revenue,
  expense,
  net,
  showAll,
}: {
  count: number;
  revenue: number;
  expense: number;
  net: number;
  /** When no filters are active, the label reads "All items" so the
   *  reviewer doesn't think the totals exclude anything. */
  showAll: boolean;
}) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm flex flex-wrap items-center gap-md text-body-md">
      <span className="text-caption uppercase tracking-wider font-semibold text-on-surface-variant">
        {showAll ? "All items" : "Filtered"}
      </span>
      <span className="text-body-md">
        <strong className="text-on-surface">{count}</strong>{" "}
        <span className="text-on-surface-variant text-caption">
          {count === 1 ? "item" : "items"}
        </span>
      </span>
      <Stat label="Revenue" value={revenue} tone="positive" />
      <Stat label="Expense" value={expense} tone="negative" />
      <Stat label="Net" value={net} tone={net >= 0 ? "positive" : "negative"} bold />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: number;
  tone: "positive" | "negative";
  bold?: boolean;
}) {
  const color = tone === "positive" ? "text-green-700" : "text-red-700";
  return (
    <span className="inline-flex items-baseline gap-xs">
      <span className="text-caption uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
      <span className={`font-mono ${color} ${bold ? "font-bold" : "font-semibold"} tabular-nums`}>
        {(value < 0 ? "−" : "") + inrFull(Math.abs(value)).replace(/^[₹]/, "₹")}
      </span>
    </span>
  );
}

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
  categoryFilter,
  paymentFilter,
  parties,
  categoryOptions,
  paymentOptions,
}: {
  tab: TabKey;
  typeFilter: TypeFilter;
  fromDate: string;
  toDate: string;
  partyFilter: string;
  categoryFilter: string;
  paymentFilter: string;
  parties: Array<{ id: string; name: string; group: string; isActive: boolean }>;
  categoryOptions: string[];
  paymentOptions: string[];
}) {
  const hasAnyFilter =
    !!fromDate || !!toDate || !!partyFilter || !!categoryFilter || !!paymentFilter;
  const clearHref =
    typeFilter === "all" ? `/finance/approvals/${tab}` : `/finance/approvals/${tab}?type=${typeFilter}`;
  // If a selected category/payment isn't in the (type-scoped) options
  // list, append it so the user can still see + clear their stale
  // pick — otherwise it would be silently filtering invisibly.
  const categoryChoices =
    categoryFilter && !categoryOptions.includes(categoryFilter)
      ? [...categoryOptions, categoryFilter]
      : categoryOptions;
  const paymentChoices =
    paymentFilter && !paymentOptions.includes(paymentFilter)
      ? [...paymentOptions, paymentFilter]
      : paymentOptions;
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
      <label className="flex flex-col gap-[2px] text-caption text-on-surface-variant">
        <span className="uppercase tracking-wider font-semibold">Category</span>
        <select
          name="category"
          defaultValue={categoryFilter}
          className="h-9 px-sm rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md min-w-[180px]"
        >
          <option value="">All categories</option>
          {categoryChoices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-[2px] text-caption text-on-surface-variant">
        <span className="uppercase tracking-wider font-semibold">Payment</span>
        <select
          name="payment"
          defaultValue={paymentFilter}
          className="h-9 px-sm rounded-md border border-outline-variant bg-surface-container-lowest text-on-surface text-body-md min-w-[160px]"
        >
          <option value="">All modes</option>
          {paymentChoices.map((m) => (
            <option key={m} value={m}>
              {m}
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
  categoryFilter,
  paymentFilter,
}: {
  tab: TabKey;
  active: TypeFilter;
  counts: { all: number; Revenue: number; Expense: number };
  fromDate: string;
  toDate: string;
  partyFilter: string;
  categoryFilter: string;
  paymentFilter: string;
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
    // Type changes can invalidate category/payment options (e.g. a
    // Revenue-only category selected, then Expense chosen) so we drop
    // those filters when the user switches type. Keep them when the
    // chosen type matches the current one (no-op click).
    if (key === active) {
      if (categoryFilter) qs.set("category", categoryFilter);
      if (paymentFilter) qs.set("payment", paymentFilter);
    }
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
  employeeById,
}: {
  before: ProposedTx | null;
  after: ProposedTx | null;
  partyById: Map<string, { id: string; name: string; group: string }>;
  employeeById: Map<string, { id: string; name: string }>;
}) {
  const fields: DiffField[] = [
    { key: "date", label: "Date" },
    { key: "month", label: "Month" },
    { key: "type", label: "Type" },
    { key: "category", label: "Category" },
    { key: "subItem", label: "Sub-item" },
    { key: "partyId", label: "Party" },
    { key: "employeeId", label: "Employee" },
    { key: "description", label: "Description" },
    { key: "paymentMode", label: "Payment mode" },
    { key: "flow", label: "Flow" },
    { key: "expDom", label: "EXP / DOM" },
    { key: "amount", label: "Total amount" },
  ];
  const renderPartyId = (id: unknown) => {
    if (id === null || id === undefined || id === "") return "—";
    const p = partyById.get(String(id));
    return p ? `${p.name} (${p.group})` : `(deleted party: ${String(id).slice(0, 8)})`;
  };
  const renderEmployeeId = (id: unknown) => {
    if (id === null || id === undefined || id === "") return "—";
    const e = employeeById.get(String(id));
    return e ? `${e.name} (Employee)` : `(removed employee: ${String(id).slice(0, 8)})`;
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
              if (f.key === "employeeId") return renderEmployeeId(v);
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
