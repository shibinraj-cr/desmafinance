import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { prisma } from "@/lib/prisma";
import { inrFull } from "@/lib/format";
import { parsePeriod, periodLabel, rangeFor } from "@/lib/period";
import { DateFilter } from "@/components/DateFilter";
import { DeleteRowButton } from "./delete-button";

export const dynamic = "force-dynamic";

export default async function DailyTrackerPage({
  searchParams,
}: {
  searchParams: { period?: string; from?: string; to?: string; type?: string };
}) {
  const period = parsePeriod(searchParams);
  const range = rangeFor(period);
  const where = {
    deletedAt: null,
    ...(searchParams.type ? { type: searchParams.type } : {}),
    ...(range.from || range.to
      ? {
          date: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? { lt: range.to } : {}),
          },
        }
      : {}),
  };
  const items = await prisma.transaction.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  // Running balance is computed across the full timeline of (currently filtered) rows
  // in chronological order, then mapped back by id for newest-first display.
  const chronological = [...items].sort(
    (a, b) => +a.date - +b.date || +a.createdAt - +b.createdAt,
  );
  const balanceMap = new Map<string, number>();
  let running = 0;
  for (const t of chronological) {
    const v = Number(t.amount.toString());
    running += t.type === "Revenue" ? v : -v;
    balanceMap.set(t.id, running);
  }

  const filterQs = (extra: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    if (searchParams.period) qs.set("period", searchParams.period);
    if (searchParams.from) qs.set("from", searchParams.from);
    if (searchParams.to) qs.set("to", searchParams.to);
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

        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-body-md">
              <thead className="bg-surface-container-low text-on-surface-variant">
                <tr className="text-left">
                  <Th>Date</Th>
                  <Th>Month</Th>
                  <Th>Type</Th>
                  <Th>Category</Th>
                  <Th>Sub-Item</Th>
                  <Th>Description</Th>
                  <Th>Mode</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Running</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-lg text-center text-on-surface-variant">
                      No transactions match this filter. Click <strong>New</strong> to add one.
                    </td>
                  </tr>
                )}
                {items.map((t) => {
                  const v = Number(t.amount.toString());
                  const inflow = t.type === "Revenue";
                  const rowTint = inflow ? "bg-green-50/30" : "bg-red-50/30";
                  return (
                    <tr
                      key={t.id}
                      className={
                        "border-t border-outline-variant/60 hover:bg-surface-container-low " +
                        rowTint
                      }
                    >
                      <Td>{t.date.toISOString().slice(0, 10)}</Td>
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
                      <Td className="max-w-[260px] truncate">{t.description ?? "—"}</Td>
                      <Td>{t.paymentMode}</Td>
                      <Td className={"text-right font-mono " + (inflow ? "text-green-700" : "text-red-700")}>
                        {(inflow ? "+" : "−") + inrFull(v).slice(1)}
                      </Td>
                      <Td className="text-right font-mono text-on-surface">
                        {inrFull(balanceMap.get(t.id) ?? 0)}
                      </Td>
                      <Td className="text-right whitespace-nowrap">
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
