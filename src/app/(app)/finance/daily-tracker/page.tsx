import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { inrFull } from "@/lib/format";
import { parsePeriod, periodLabel, rangeFor } from "@/lib/period";
import { DateFilter } from "@/components/DateFilter";
import { FilterBand } from "@/components/FilterBand";
import { DeleteRowButton } from "./delete-button";

export const dynamic = "force-dynamic";

/** Format a JS Date as DD-MM-YY (Indian-finance convention). */
function fmtDDMMYY(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}

export default async function DailyTrackerPage({
  searchParams,
}: {
  searchParams: {
    period?: string;
    from?: string;
    to?: string;
    type?: string;
    category?: string;
    sub?: string;
    party?: string;
    mode?: string;
    flow?: string;
  };
}) {
  const period = parsePeriod(searchParams);
  const range = rangeFor(period);
  const where = {
    deletedAt: null,
    ...(searchParams.type ? { type: searchParams.type } : {}),
    ...(searchParams.category ? { category: searchParams.category } : {}),
    ...(searchParams.sub ? { subItem: searchParams.sub } : {}),
    ...(searchParams.party ? { partyId: searchParams.party } : {}),
    ...(searchParams.mode ? { paymentMode: searchParams.mode } : {}),
    ...(searchParams.flow ? { flow: searchParams.flow } : {}),
    ...(range.from || range.to
      ? {
          date: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lt: range.to } : {}),
          },
        }
      : {}),
  };
  const [items, pendingCreates, pendingMutations, categories, parties, employees] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
    // Pending creates aren't in Transaction yet; filter in JS on the
    // proposed-payload because it's stored as JSON and Prisma can't
    // query nested keys easily.
    prisma.pendingApproval.findMany({
      where: { status: "pending", kind: "create" },
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    }),
    // Pending edits / deletes of existing transactions — tag each
    // affected canonical row with a "pending edit/delete" status.
    prisma.pendingApproval.findMany({
      where: { status: "pending", kind: { in: ["update", "delete"] }, targetTxId: { not: null } },
      select: { kind: true, targetTxId: true },
    }),
    prisma.category.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: {
        subItems: {
          orderBy: [{ name: "asc" }],
          select: { id: true, name: true, isActive: true },
        },
      },
    }),
    prisma.party.findMany({
      orderBy: [{ group: "asc" }, { name: "asc" }],
      select: { id: true, name: true, group: true, txTypes: true, isActive: true },
    }),
    // Active employees — to resolve employee-attributed outflows (salary /
    // incentive) to a name in the ledger.
    prisma.employee.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  // Party id → name lookup used by both Transaction rows and pending
  // creates (whose partyId lives inside the JSON proposed payload).
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  // Map: txId → kind of pending mutation (update | delete) on it.
  const pendingByTx = new Map<string, "update" | "delete">();
  for (const p of pendingMutations) {
    if (p.targetTxId) pendingByTx.set(p.targetTxId, p.kind as "update" | "delete");
  }

  // Build a unified row list: approved Transaction rows + still-pending
  // PendingApproval(kind=create) rows. Each row carries `_status` so the
  // table can colour-code accordingly.
  type ProposedTx = {
    date?: string;
    month?: string;
    type?: string;
    category?: string;
    subItem?: string;
    description?: string | null;
    paymentMode?: string;
    amount?: number | string;
    flow?: string;
    partyId?: string | null;
    employeeId?: string | null;
  };
  type UnifiedRow = {
    id: string;
    isPending: boolean;
    pendingKind?: "create" | "update" | "delete";
    date: Date;
    month: string;
    type: string;
    category: string;
    subItem: string;
    description: string | null;
    paymentMode: string;
    amount: number;
    flow: string;
    partyId: string | null;
    employeeId: string | null;
  };

  const approvedRows: UnifiedRow[] = items.map((t) => ({
    id: t.id,
    isPending: false,
    pendingKind: pendingByTx.get(t.id),
    date: t.date,
    month: t.month,
    type: t.type,
    category: t.category,
    subItem: t.subItem,
    description: t.description,
    paymentMode: t.paymentMode,
    amount: Number(t.amount.toString()),
    flow: t.flow,
    partyId: t.partyId,
    employeeId: t.employeeId,
  }));

  // Apply the same filter set to pending creates by reading the JSON
  // proposed payload. Keeps the unified view consistent with whatever
  // the user has filtered to.
  const pendingRows: UnifiedRow[] = pendingCreates
    .map((p): UnifiedRow | null => {
      const d = (p.proposed as unknown as ProposedTx | null) ?? {};
      const dateRaw = typeof d.date === "string" ? new Date(d.date) : null;
      if (!dateRaw || isNaN(+dateRaw)) return null;
      return {
        id: `pending:${p.id}`,
        isPending: true,
        pendingKind: "create",
        date: dateRaw,
        month: d.month ?? "",
        type: d.type ?? "",
        category: d.category ?? "",
        subItem: d.subItem ?? "",
        description: d.description ?? null,
        paymentMode: d.paymentMode ?? "",
        amount: Number(d.amount ?? 0),
        flow: d.flow ?? "",
        partyId: d.partyId ?? null,
        employeeId: d.employeeId ?? null,
      };
    })
    .filter((r): r is UnifiedRow => r !== null)
    .filter((r) => {
      if (searchParams.type && r.type !== searchParams.type) return false;
      if (searchParams.category && r.category !== searchParams.category) return false;
      if (searchParams.sub && r.subItem !== searchParams.sub) return false;
      if (searchParams.party && r.partyId !== searchParams.party) return false;
      if (searchParams.mode && r.paymentMode !== searchParams.mode) return false;
      if (searchParams.flow && r.flow !== searchParams.flow) return false;
      if (range.from && r.date < range.from) return false;
      if (range.to && r.date >= range.to) return false;
      return true;
    });

  const unified = [...approvedRows, ...pendingRows].sort(
    (a, b) => +b.date - +a.date || a.id.localeCompare(b.id),
  );

  // Totals reflect whatever is currently visible (approved + pending,
  // narrowed by every active filter). Pending creates / edits are
  // included so reviewers see the full ₹ impact of the filter slice.
  let totalRevenue = 0;
  let totalExpense = 0;
  for (const r of unified) {
    if (!Number.isFinite(r.amount)) continue;
    if (r.type === "Revenue") totalRevenue += r.amount;
    else if (r.type === "Expense") totalExpense += r.amount;
  }
  const totalNet = totalRevenue - totalExpense;
  const hasActiveFilters =
    !!searchParams.type ||
    !!searchParams.category ||
    !!searchParams.sub ||
    !!searchParams.party ||
    !!searchParams.mode ||
    !!searchParams.flow ||
    !!searchParams.period ||
    !!searchParams.from ||
    !!searchParams.to;

  const filterQs = (extra: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    if (searchParams.period) qs.set("period", searchParams.period);
    if (searchParams.from) qs.set("from", searchParams.from);
    if (searchParams.to) qs.set("to", searchParams.to);
    // Preserve party/mode/flow across type-chip clicks; drop
    // category/sub since they're type-scoped and would silently filter
    // to zero rows after a type swap.
    if (searchParams.party) qs.set("party", searchParams.party);
    if (searchParams.mode) qs.set("mode", searchParams.mode);
    if (searchParams.flow) qs.set("flow", searchParams.flow);
    for (const [k, v] of Object.entries(extra)) {
      if (v) qs.set(k, v);
      else qs.delete(k);
    }
    const s = qs.toString();
    return s ? "?" + s : "";
  };

  return (
    <>
      <TopBar
        title="Daily Tracker"
        subtitle={`${items.length} transactions · ${periodLabel(period)}`}
        action={
          <div className="flex items-center gap-base">
            <DateFilter />
            <Link
              href="/finance/daily-tracker/new"
              className="inline-flex items-center gap-xs h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                add
              </span>
              New
            </Link>
          </div>
        }
      />
      <div className="p-margin space-y-lg">
        <div className="flex flex-wrap gap-base items-center">
          <FilterChip
            href={"/finance/daily-tracker" + filterQs({ type: undefined })}
            active={!searchParams.type}
          >
            All
          </FilterChip>
          <FilterChip
            href={"/finance/daily-tracker" + filterQs({ type: "Revenue" })}
            active={searchParams.type === "Revenue"}
          >
            Inflow
          </FilterChip>
          <FilterChip
            href={"/finance/daily-tracker" + filterQs({ type: "Expense" })}
            active={searchParams.type === "Expense"}
          >
            Outflow
          </FilterChip>
        </div>

        <FilterBand
          categories={categories.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type as "Revenue" | "Expense" | "Both",
            isActive: c.isActive,
            subItems: c.subItems,
          }))}
          parties={parties.map((p) => ({
            id: p.id,
            name: p.name,
            group: p.group as "Candidate" | "Vendor",
            txTypes: p.txTypes as "Revenue" | "Expense" | "Both",
            isActive: p.isActive,
          }))}
          type={searchParams.type}
        />

        <TotalsStrip
          count={unified.length}
          revenue={totalRevenue}
          expense={totalExpense}
          net={totalNet}
          showAll={!hasActiveFilters}
        />

        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          {/*
            Frozen header: the wrapper handles both axes, the inner
            table's thead sticks to its top inside this scroll context
            so column titles stay visible while the body scrolls. Cap
            the vertical height so the table itself takes the scroll
            (otherwise the page would scroll and the thead would drift).
          */}
          <div className="overflow-auto scrollbar-thin max-h-[calc(100vh-220px)]">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container-low text-on-surface-variant sticky top-0 z-10 shadow-[0_1px_0_0_var(--lp-outline-variant)]">
                <tr className="text-left">
                  <Th>Date</Th>
                  <Th>Month</Th>
                  <Th>Type</Th>
                  <Th>Category</Th>
                  <Th>Sub-Item</Th>
                  <Th>Party</Th>
                  <Th>Description</Th>
                  <Th>Mode</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {unified.length === 0 && (
                  <tr>
                    <td colSpan={11} className="p-lg text-center text-on-surface-variant">
                      No transactions match this filter. Click <strong>New</strong> to add one.
                    </td>
                  </tr>
                )}
                {unified.map((t) => {
                  const inflow = t.type === "Revenue";
                  // Status drives the row tint:
                  //   pending create   → amber
                  //   pending update   → blue (info)
                  //   pending delete   → red (alarming)
                  //   approved+inflow  → soft green
                  //   approved+outflow → soft red
                  const rowTint =
                    t.pendingKind === "create"
                      ? "bg-amber-50/50"
                      : t.pendingKind === "update"
                        ? "bg-blue-50/50"
                        : t.pendingKind === "delete"
                          ? "bg-red-100/50"
                          : inflow
                            ? "bg-green-50/30"
                            : "bg-red-50/30";
                  const statusLabel =
                    t.pendingKind === "create"
                      ? "Pending approval"
                      : t.pendingKind === "update"
                        ? "Pending edit"
                        : t.pendingKind === "delete"
                          ? "Pending delete"
                          : "Approved";
                  const statusPill =
                    t.pendingKind === "create"
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : t.pendingKind === "update"
                        ? "bg-blue-100 text-blue-800 border border-blue-300"
                        : t.pendingKind === "delete"
                          ? "bg-red-100 text-red-800 border border-red-300"
                          : "bg-green-100 text-green-800 border border-green-300";
                  const party = t.partyId ? partyById.get(t.partyId) : null;
                  const employee = t.employeeId ? employeeById.get(t.employeeId) : null;
                  return (
                    <tr
                      key={t.id}
                      className={
                        "border-t border-outline-variant/60 hover:bg-surface-container-low " +
                        rowTint
                      }
                    >
                      <Td className="whitespace-nowrap tabular-nums">{fmtDDMMYY(t.date)}</Td>
                      <Td>{t.month}</Td>
                      <Td>
                        <span
                          className={
                            "px-xs py-[2px] rounded-full text-[11px] font-semibold " +
                            (inflow ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")
                          }
                        >
                          {inflow ? "Inflow" : "Outflow"}
                        </span>
                      </Td>
                      <Td>{t.category}</Td>
                      <Td>{t.subItem}</Td>
                      <Td className="max-w-[200px] truncate">
                        {party ? (
                          <span>
                            {party.name}
                            <span className="text-on-surface-variant text-[11px] ml-[4px]">
                              ({party.group})
                            </span>
                          </span>
                        ) : employee ? (
                          <span>
                            {employee.name}
                            <span className="text-on-surface-variant text-[11px] ml-[4px]">
                              (Employee)
                            </span>
                          </span>
                        ) : (
                          <span className="text-on-surface-variant">—</span>
                        )}
                      </Td>
                      <Td className="max-w-[220px] truncate">{t.description ?? "—"}</Td>
                      <Td>{t.paymentMode}</Td>
                      <Td className={"text-right font-mono " + (inflow ? "text-green-700" : "text-red-700")}>
                        {(inflow ? "+" : "−") + inrFull(t.amount).slice(1)}
                      </Td>
                      <Td>
                        <span
                          className={
                            "px-xs py-[2px] rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap " +
                            statusPill
                          }
                        >
                          {statusLabel}
                        </span>
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        {t.isPending ? (
                          <Link
                            href="/finance/approvals/pending"
                            title="Open Approvals queue"
                            className="inline-flex p-xs text-on-surface-variant hover:text-accent transition"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                              rule
                            </span>
                          </Link>
                        ) : (
                          <>
                            <Link
                              href={`/finance/daily-tracker/${t.id}/edit`}
                              title="Edit"
                              className="inline-flex p-xs text-on-surface-variant hover:text-accent transition"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                                edit
                              </span>
                            </Link>
                            <DeleteRowButton id={t.id} />
                          </>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={"px-md py-sm text-label-sm uppercase tracking-wider " + className}>{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={"px-md py-sm align-middle " + className}>{children}</td>;
}
function TotalsStrip({
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
  /** When no filters are set we still want to show totals, but the
   *  label flips to "All transactions" so the reader doesn't think a
   *  hidden filter is in play. */
  showAll: boolean;
}) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest px-md py-sm flex flex-wrap items-center gap-md text-body-md">
      <span className="text-caption uppercase tracking-wider font-semibold text-on-surface-variant">
        {showAll ? "All transactions" : "Filtered"}
      </span>
      <span className="text-body-md">
        <strong className="text-on-surface">{count}</strong>{" "}
        <span className="text-on-surface-variant text-caption">
          {count === 1 ? "row" : "rows"}
        </span>
      </span>
      <TotalStat label="Inflow" value={revenue} tone="positive" />
      <TotalStat label="Outflow" value={expense} tone="negative" />
      <TotalStat label="Net" value={net} tone={net >= 0 ? "positive" : "negative"} bold />
    </div>
  );
}

function TotalStat({
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
        {(value < 0 ? "−" : "") + inrFull(Math.abs(value))}
      </span>
    </span>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "h-8 inline-flex items-center px-md rounded-full text-label-sm border transition " +
        (active
          ? "bg-primary text-on-primary border-primary"
          : "bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container-low")
      }
    >
      {children}
    </Link>
  );
}
