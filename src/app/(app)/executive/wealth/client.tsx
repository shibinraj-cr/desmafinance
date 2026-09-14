"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KpiCard } from "@/components/Cards";
import { AllocationChart, NetWorthBridge, OutflowChart } from "@/components/WealthCharts";
import { inrCompact, inrFull } from "@/lib/format";
import {
  ASSET_CLASS_META,
  LIABILITY_KIND_LABEL,
  SELECTABLE_ASSET_CLASSES,
  bridgeSteps,
  computeAllocation,
  computeTotals,
  outflowByMonth,
  type AssetClassKey,
  type BridgeStep,
  type GoldItemRow,
  type HoldingRow,
  type LiabilityRow,
  type OutflowMonth,
  type ReminderRow,
  type WealthSnapshot,
} from "@/lib/wealth-model";
import {
  Drawer,
  ErrorNote,
  GoldForm,
  HoldingForm,
  LiabilityForm,
  draftFromGold,
  draftFromHolding,
  draftFromLiability,
  emptyGoldDraft,
  emptyHoldingDraft,
  emptyLiabilityDraft,
  inputCls,
  primaryBtn,
  secondaryBtn,
  type GoldDraft,
  type HoldingDraft,
  type LiabilityDraft,
} from "./editors";

// ── plumbing ────────────────────────────────────────────────────────────────

const API_ERRORS: Record<string, string> = {
  validation_error: "Please check the highlighted fields.",
  secret_vault_unconfigured:
    "Passwords can't be stored until WEALTH_SECRET_KEY is set on the server. Everything else saved.",
  secret_undecryptable:
    "That password can't be read — the server key changed since it was saved. Type it again to re-store it.",
  no_secret_stored: "No password is stored for this holding yet.",
  not_found: "That row no longer exists — refresh the page.",
  forbidden: "You don't have access to this page.",
  unauthorized: "Your session expired. Sign in again.",
};

async function call(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = typeof data.error === "string" ? data.error : "";
      return { ok: false, message: API_ERRORS[code] ?? data.message ?? "That didn't save. Try again." };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** Empty string → null; anything else → a finite number, or null if unparseable. */
function numOrNull(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(s: string): number | null {
  const n = numOrNull(s);
  return n === null ? null : Math.round(n);
}
function textOrNull(s: string): string | null {
  const t = s.trim();
  return t === "" ? null : t;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function prettyDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function Chip({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: "neutral" | "critical" | "warning" | "good" | "gold";
  icon?: string;
  children: React.ReactNode;
}) {
  const cls = {
    neutral: "bg-surface-container text-on-surface-variant border-outline-variant",
    critical: "bg-error-container text-on-error-container border-error/30",
    warning: "bg-amber-50 text-amber-800 border-amber-200",
    good: "bg-green-50 text-green-700 border-green-200",
    gold: "bg-primary-fixed/40 text-accent border-primary-fixed",
  }[tone];
  return (
    <span
      className={
        "inline-flex items-center gap-xs px-sm py-[2px] rounded-full border text-caption font-semibold whitespace-nowrap " +
        cls
      }
    >
      {icon && (
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

function Card({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm">
      <div className="flex flex-wrap items-baseline gap-sm px-lg pt-lg">
        <h3 className="text-h3 text-on-surface">{title}</h3>
        {note && <span className="text-caption text-on-surface-variant">{note}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="px-lg pb-lg pt-md">{children}</div>
    </section>
  );
}

// ── the page ────────────────────────────────────────────────────────────────

type DrawerState =
  | { kind: "none" }
  | { kind: "holding"; holding: HoldingRow | null }
  | { kind: "liability"; liability: LiabilityRow | null }
  | { kind: "gold"; item: GoldItemRow | null };

export function WealthClient({
  snapshot,
  outflow,
  bridge,
}: {
  snapshot: WealthSnapshot;
  outflow: OutflowMonth[];
  bridge: BridgeStep[];
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [personalOnly, setPersonalOnly] = useState(snapshot.settings.hideBusinessScope);
  const [drawer, setDrawer] = useState<DrawerState>({ kind: "none" });
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { today } = snapshot;

  // Scoping is a client-side lens over the same rows: the server always sends
  // everything, so flipping it re-derives instantly instead of round-tripping.
  const view = useMemo(() => {
    if (!personalOnly) {
      return {
        holdings: snapshot.holdings,
        liabilities: snapshot.liabilities,
        totals: snapshot.totals,
        allocation: snapshot.allocation,
        bridge,
        outflow,
      };
    }
    const holdings = snapshot.holdings.filter((h) => h.scope === "personal");
    const liabilities = snapshot.liabilities.filter((l) => l.scope === "personal");
    const keptIds = new Set(holdings.map((h) => h.id));
    const reminders = snapshot.reminders.filter(
      (r) => !r.holdingId || keptIds.has(r.holdingId),
    );
    const totals = computeTotals({
      holdings,
      goldValue: snapshot.gold.value,
      liabilities,
      reminders,
      today,
    });
    return {
      holdings,
      liabilities,
      totals,
      allocation: computeAllocation(holdings, snapshot.gold.value),
      bridge: bridgeSteps(totals, liabilities),
      outflow: outflowByMonth(reminders, today),
    };
  }, [personalOnly, snapshot, bridge, outflow, today]);

  const totals = view.totals;
  // Cover-only policies are holdings, but they add nothing to the corpus — so
  // they must not be counted beside the corpus figure.
  const corpusHoldings = view.holdings.filter(
    (h) => ASSET_CLASS_META[h.assetClass]?.countsToCorpus,
  ).length;
  const businessCount =
    snapshot.holdings.filter((h) => h.scope === "business").length +
    snapshot.liabilities.filter((l) => l.scope === "business").length;

  const attention = useMemo(() => {
    const open = snapshot.reminders.filter((r) => r.status === "open");
    const overdue = open.filter((r) => r.bucket === "overdue");
    const soon = open.filter((r) => r.bucket === "due_soon");
    return { overdue, soon, all: [...overdue, ...soon] };
  }, [snapshot.reminders]);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function settle(reminder: ReminderRow, status: "paid" | "skipped") {
    setPendingId(reminder.id);
    setError(null);
    const res = await call(`/api/wealth/reminders/${reminder.id}`, "PATCH", { status });
    setPendingId(null);
    if (!res.ok) setError(res.message);
    else refresh();
  }

  if (snapshot.isEmpty) {
    return (
      <div className="p-margin">
        <EmptyDesk
          onAdd={() => setDrawer({ kind: "holding", holding: null })}
          onAddLiability={() => setDrawer({ kind: "liability", liability: null })}
        />
        <Editors
          drawer={drawer}
          setDrawer={setDrawer}
          snapshot={snapshot}
          onSaved={refresh}
        />
      </div>
    );
  }

  return (
    <div className="p-margin space-y-lg">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-md bg-surface-container-lowest border border-outline-variant rounded-xl px-lg py-md">
        <span className="text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
          View
        </span>
        <div className="flex items-center gap-xs bg-surface-container rounded-lg p-[3px]">
          <button
            type="button"
            onClick={() => setPersonalOnly(false)}
            className={
              "h-8 px-md rounded-md text-label-sm font-semibold transition " +
              (!personalOnly
                ? "bg-surface-container-lowest text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface")
            }
          >
            Everything
          </button>
          <button
            type="button"
            onClick={() => setPersonalOnly(true)}
            className={
              "h-8 px-md rounded-md text-label-sm font-semibold transition " +
              (personalOnly
                ? "bg-surface-container-lowest text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface")
            }
          >
            Personal only
          </button>
        </div>
        {businessCount > 0 && (
          <span className="text-caption text-on-surface-variant">
            {personalOnly
              ? `${businessCount} business item${businessCount === 1 ? "" : "s"} hidden`
              : `${businessCount} item${businessCount === 1 ? "" : "s"} tagged business`}
          </span>
        )}
        <span className="text-caption text-on-surface-variant ml-auto">As on {prettyDate(today)}</span>
        <button
          type="button"
          className={primaryBtn}
          onClick={() => setDrawer({ kind: "holding", holding: null })}
        >
          <span className="material-symbols-outlined align-middle mr-xs" style={{ fontSize: 18 }}>
            add
          </span>
          Add holding
        </button>
      </div>

      <ErrorNote message={error} />

      {/* Attention rail */}
      <AttentionRail
        overdue={attention.overdue}
        soon={attention.soon}
        pendingId={pendingId}
        busy={busy}
        onSettle={settle}
      />

      {/* Headline figures */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-gutter">
        <KpiCard
          label="Net worth"
          value={inrCompact(totals.netWorth)}
          dark
          hero
          hint={`Assets ${inrCompact(totals.assets)} − owed ${inrCompact(totals.liabilities)}`}
        />
        <KpiCard
          label="Invested corpus"
          value={inrCompact(totals.corpus)}
          hero
          tone="primary"
          hint={`${corpusHoldings} holding${corpusHoldings === 1 ? "" : "s"} across ${view.allocation.filter((a) => a.key !== "gold").length} classes`}
        />
        <KpiCard
          label="Gold vault"
          value={inrCompact(totals.goldValue)}
          hero
          hint={
            snapshot.gold.ratePerGram > 0
              ? `${snapshot.gold.totalGrams.toLocaleString("en-IN")} g · ${(snapshot.gold.totalGrams / 8).toFixed(1)} pavan @ ₹${snapshot.gold.ratePerGram.toLocaleString("en-IN")}/g`
              : "Set a rate below to price the vault"
          }
        />
        <KpiCard
          label="Liabilities"
          value={inrCompact(totals.liabilities)}
          hero
          tone="danger"
          hint={
            totals.debtToAssetPct === null
              ? "No assets recorded yet"
              : `${totals.debtToAssetPct.toFixed(1)}% of assets`
          }
        />
        <KpiCard
          label="Due · next 90 days"
          value={inrCompact(totals.dueNext90Days)}
          hero
          tone={totals.overdueCount > 0 ? "danger" : "success"}
          hint={
            totals.dueNext90Count === 0
              ? "Nothing scheduled"
              : `${totals.dueNext90Count} dated item${totals.dueNext90Count === 1 ? "" : "s"}${
                  totals.commitmentUnknownCount > 0
                    ? ` · ${totals.commitmentUnknownCount} amount${totals.commitmentUnknownCount === 1 ? "" : "s"} not captured`
                    : ""
                }`
          }
        />
        <KpiCard
          label="Annual commitment"
          value={inrCompact(totals.annualCommitment)}
          hero
          hint={`≈ ${inrCompact(totals.annualCommitment / 12)} a month of SIPs, premiums and EMIs`}
        />
      </section>

      {/* Composition */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
        <Card title="How net worth is built" note="Assets, then what is owed against them">
          <NetWorthBridge steps={view.bridge} />
          {totals.debtToAssetPct !== null && (
            <div className="flex flex-wrap gap-sm mt-md">
              <Chip>Debt-to-asset {totals.debtToAssetPct.toFixed(1)}%</Chip>
              {totals.debtToAssetPct < 40 ? (
                <Chip tone="good" icon="check_circle">
                  Inside the comfortable band (under 40%)
                </Chip>
              ) : (
                <Chip tone="warning" icon="warning">
                  Above 40% — borrowings are a large share of assets
                </Chip>
              )}
            </div>
          )}
        </Card>

        <Card title="Where the money sits" note={`Share of ${inrCompact(totals.assets)} total assets`}>
          <AllocationChart data={view.allocation} />
          {view.allocation.length > 0 && view.allocation[0].share > 0.4 && (
            <p className="text-caption text-on-surface-variant mt-md">
              {view.allocation[0].label} is {(view.allocation[0].share * 100).toFixed(0)}% of assets —
              worth a target allocation to measure drift against.
            </p>
          )}
        </Card>
      </section>

      {/* Cash out */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-gutter">
        <Card title="Cash going out" note="Dated commitments, next twelve months">
          <OutflowChart data={view.outflow} />
        </Card>
        <Card title="What falls due when" note="Next six months">
          <UpcomingList reminders={snapshot.reminders} today={today} />
        </Card>
      </section>

      {/* Holdings */}
      <Card
        title="Holdings"
        note="Click any row to edit it"
        action={
          <button
            type="button"
            className={secondaryBtn}
            onClick={() => setDrawer({ kind: "holding", holding: null })}
          >
            Add holding
          </button>
        }
      >
        <HoldingsTable
          holdings={view.holdings}
          onOpen={(h) => setDrawer({ kind: "holding", holding: h })}
        />
        {totals.staleCount > 0 && (
          <p className="mt-md text-body-md text-on-surface-variant bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm">
            <b className="text-on-surface">{inrCompact(totals.staleValue)} is valued on stale numbers.</b>{" "}
            {totals.staleCount} holding{totals.staleCount === 1 ? "" : "s"} last valued over six months
            ago{totals.staleOldestMonths ? `, the oldest ${totals.staleOldestMonths} months back` : ""}.
            Update them so net worth doesn&apos;t quietly drift from reality.
          </p>
        )}
      </Card>

      {/* Vault, borrowings, cover */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        <GoldVault
          snapshot={snapshot}
          onEdit={(item) => setDrawer({ kind: "gold", item })}
          onAdd={() => setDrawer({ kind: "gold", item: null })}
          onError={setError}
          onSaved={refresh}
        />
        <Card
          title="Liabilities"
          note={inrCompact(totals.liabilities)}
          action={
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => setDrawer({ kind: "liability", liability: null })}
            >
              Add
            </button>
          }
        >
          <LiabilityList
            liabilities={view.liabilities}
            total={totals.liabilities}
            onOpen={(l) => setDrawer({ kind: "liability", liability: l })}
          />
        </Card>
        <Card title="Protection" note="Cover, not corpus">
          <ProtectionList
            holdings={view.holdings}
            cover={totals.protectionCover}
            gap={totals.protectionGap}
            liabilities={totals.liabilities}
            onOpen={(h) => setDrawer({ kind: "holding", holding: h })}
          />
        </Card>
      </section>

      <Editors drawer={drawer} setDrawer={setDrawer} snapshot={snapshot} onSaved={refresh} />
    </div>
  );
}

// ── attention ───────────────────────────────────────────────────────────────

function AttentionRail({
  overdue,
  soon,
  pendingId,
  busy,
  onSettle,
}: {
  overdue: ReminderRow[];
  soon: ReminderRow[];
  pendingId: string | null;
  busy: boolean;
  onSettle: (r: ReminderRow, status: "paid" | "skipped") => void;
}) {
  const rows = [...overdue, ...soon];
  const amount = overdue.reduce((s, r) => s + (r.amount ?? 0), 0);
  const clear = rows.length === 0;

  return (
    <section
      className={
        "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden border-l-4 " +
        (overdue.length > 0 ? "border-l-error" : clear ? "border-l-green-600" : "border-l-amber-500")
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="px-lg py-md bg-surface-container-low border-b lg:border-b-0 lg:border-r border-outline-variant">
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
            Needs attention
          </p>
          <p
            className={
              "text-h1 font-bold mt-xs " +
              (overdue.length > 0 ? "text-error" : clear ? "text-green-700" : "text-on-surface")
            }
          >
            {clear ? "All clear" : overdue.length > 0 ? `${overdue.length} overdue` : `${soon.length} due soon`}
          </p>
          <p className="text-body-md text-on-surface-variant mt-xs">
            {clear
              ? "Nothing is overdue and nothing is inside its reminder window."
              : overdue.length > 0
                ? `${inrFull(amount)} of premiums and instalments are past their date.`
                : "Inside the lead time you set, so there is still room to fund them."}
          </p>
        </div>

        <div className="divide-y divide-outline-variant">
          {clear ? (
            <div className="px-lg py-lg text-body-md text-on-surface-variant flex items-center gap-sm">
              <span className="material-symbols-outlined text-green-700">check_circle</span>
              Everything scheduled is still ahead of its reminder window.
            </div>
          ) : (
            rows.slice(0, 8).map((r) => {
              const late = r.bucket === "overdue";
              return (
                <div
                  key={r.id}
                  className="px-lg py-sm flex flex-wrap items-center gap-md"
                >
                  <span
                    className={
                      "material-symbols-outlined " + (late ? "text-error" : "text-amber-600")
                    }
                    style={{ fontSize: 20 }}
                  >
                    {late ? "error" : "schedule"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body-md text-on-surface font-medium truncate">{r.label}</p>
                    <p className="text-caption text-on-surface-variant">
                      {r.kind} · due {prettyDate(r.dueOn)}
                    </p>
                  </div>
                  <Chip tone={late ? "critical" : "warning"} icon="schedule">
                    {late
                      ? `${Math.abs(r.daysUntil)} day${Math.abs(r.daysUntil) === 1 ? "" : "s"} late`
                      : r.daysUntil === 0
                        ? "Today"
                        : `In ${r.daysUntil} day${r.daysUntil === 1 ? "" : "s"}`}
                  </Chip>
                  <span className="text-body-md font-semibold tabular-nums w-28 text-right">
                    {r.amount == null ? "—" : inrFull(r.amount)}
                  </span>
                  <div className="flex items-center gap-xs">
                    <button
                      type="button"
                      className="h-8 px-md rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"
                      disabled={busy || pendingId === r.id}
                      onClick={() => onSettle(r, "paid")}
                    >
                      {pendingId === r.id ? "Saving…" : "Mark paid"}
                    </button>
                    <button
                      type="button"
                      title="Skip this one"
                      aria-label={`Skip ${r.label}`}
                      className="h-8 w-8 grid place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container-low disabled:opacity-50"
                      disabled={busy || pendingId === r.id}
                      onClick={() => onSettle(r, "skipped")}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        do_not_disturb_on
                      </span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
          {rows.length > 8 && (
            <div className="px-lg py-sm text-caption text-on-surface-variant">
              and {rows.length - 8} more below in the schedule.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function UpcomingList({ reminders, today }: { reminders: ReminderRow[]; today: string }) {
  const groups = useMemo(() => {
    const horizon = `${Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) > 6 ? 1 : 0)}-${String(
      ((Number(today.slice(5, 7)) + 5) % 12) + 1,
    ).padStart(2, "0")}-31`;
    const map = new Map<string, ReminderRow[]>();
    for (const r of reminders) {
      if (r.status !== "open") continue;
      if (r.dueOn > horizon) continue;
      const key = r.dueOn.slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [reminders, today]);

  if (groups.length === 0) {
    return (
      <p className="text-body-md text-on-surface-variant py-lg text-center">
        Nothing scheduled in the next six months.
      </p>
    );
  }

  return (
    <div className="divide-y divide-outline-variant">
      {groups.map(([key, rows]) => {
        const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
        const [y, m] = key.split("-").map(Number);
        return (
          <div key={key} className="py-sm grid grid-cols-[76px_minmax(0,1fr)] gap-md">
            <div>
              <p className="text-body-md font-semibold text-on-surface-variant">
                {MONTHS[m - 1]} {String(y).slice(-2)}
              </p>
              <p className="text-caption text-on-surface-variant tabular-nums">{inrCompact(total)}</p>
            </div>
            <div className="flex flex-wrap gap-xs">
              {rows.map((r) => (
                <Chip
                  key={r.id}
                  tone={r.dueOn < today ? "critical" : (r.amount ?? 0) >= 400_000 ? "warning" : "neutral"}
                  icon={r.dueOn < today ? "error" : undefined}
                >
                  {Number(r.dueOn.slice(8))} · {r.label} · {r.amount == null ? "—" : inrCompact(r.amount)}
                </Chip>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── holdings ────────────────────────────────────────────────────────────────

function HoldingsTable({
  holdings,
  onOpen,
}: {
  holdings: HoldingRow[];
  onOpen: (h: HoldingRow) => void;
}) {
  const groups = useMemo(() => {
    const byClass = new Map<AssetClassKey, HoldingRow[]>();
    for (const h of holdings) {
      if (!byClass.has(h.assetClass)) byClass.set(h.assetClass, []);
      byClass.get(h.assetClass)!.push(h);
    }
    return SELECTABLE_ASSET_CLASSES.filter((k) => byClass.has(k)).map((k) => ({
      key: k,
      rows: byClass.get(k)!.sort((a, b) => b.value - a.value),
      total: byClass.get(k)!.reduce((s, h) => s + h.value, 0),
    }));
  }, [holdings]);

  if (holdings.length === 0) {
    return (
      <p className="text-body-md text-on-surface-variant py-lg text-center">
        No holdings in this view.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-body-md min-w-[900px]">
        <thead>
          <tr className="text-on-surface-variant">
            <th className="text-left text-label-sm uppercase tracking-wider px-md pb-sm">Holding</th>
            <th className="text-left text-label-sm uppercase tracking-wider px-md pb-sm">For</th>
            <th className="text-left text-label-sm uppercase tracking-wider px-md pb-sm">Contribution</th>
            <th className="text-left text-label-sm uppercase tracking-wider px-md pb-sm">Next due</th>
            <th className="text-right text-label-sm uppercase tracking-wider px-md pb-sm">Value</th>
            <th className="text-left text-label-sm uppercase tracking-wider px-md pb-sm">Valued on</th>
            <th className="text-left text-label-sm uppercase tracking-wider px-md pb-sm">Portal</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              <tr className="bg-surface-container-low">
                <td colSpan={7} className="px-md py-xs text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <span
                    className="inline-block w-[9px] h-[9px] rounded-sm mr-sm align-middle"
                    style={{ background: ASSET_CLASS_META[g.key].color }}
                  />
                  {ASSET_CLASS_META[g.key].label} · {inrCompact(g.total)} · {g.rows.length}
                </td>
              </tr>
              {g.rows.map((h) => (
                <tr
                  key={h.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => onOpen(h)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(h);
                    }
                  }}
                  className="border-b border-outline-variant/60 hover:bg-primary-fixed/20 cursor-pointer"
                >
                  <td className="px-md py-sm">
                    <div className="font-medium text-on-surface flex items-center gap-xs">
                      {h.name}
                      {h.hasSecret && (
                        <span
                          className="material-symbols-outlined text-accent"
                          style={{ fontSize: 15 }}
                          title="Portal password stored"
                        >
                          key
                        </span>
                      )}
                      {h.scope === "business" && <Chip>business</Chip>}
                    </div>
                    {(h.institution || h.policyNo) && (
                      <div className="text-caption text-on-surface-variant">
                        {[h.institution, h.policyNo].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="px-md py-sm text-on-surface-variant">{h.holderLabel}</td>
                  <td className="px-md py-sm">
                    <span className="tabular-nums">
                      {h.contributionAmount == null ? "—" : inrFull(h.contributionAmount)}
                    </span>
                    <div className="text-caption text-on-surface-variant capitalize">
                      {h.frequency.replace("_", " ")}
                    </div>
                  </td>
                  <td className="px-md py-sm">
                    {h.nextDueOn ? (
                      <Chip tone={(h.contributionAmount ?? 0) >= 400_000 ? "warning" : "neutral"} icon="event">
                        {prettyDate(h.nextDueOn)}
                      </Chip>
                    ) : (
                      <span className="text-on-surface-variant">—</span>
                    )}
                  </td>
                  <td className="px-md py-sm text-right font-semibold tabular-nums">
                    {h.assetClass === "protection"
                      ? h.sumAssured
                        ? `${inrCompact(h.sumAssured)} cover`
                        : "—"
                      : inrCompact(h.value)}
                  </td>
                  <td className={"px-md py-sm " + (h.isStale ? "text-amber-700 font-semibold" : "text-on-surface-variant")}>
                    {h.valuedOn ? prettyDate(h.valuedOn) : "Never"}
                    {h.isStale && h.valuationAgeMonths != null && (
                      <div className="text-caption">{h.valuationAgeMonths} months old</div>
                    )}
                  </td>
                  <td className="px-md py-sm">
                    {h.portalUrl ? (
                      <a
                        href={h.portalUrl.startsWith("http") ? h.portalUrl : `https://${h.portalUrl}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={(e) => e.stopPropagation()}
                        className="text-accent hover:underline inline-flex items-center gap-xs"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                          open_in_new
                        </span>
                        {h.portalUrl.replace(/^https?:\/\//, "").split("/")[0]}
                      </a>
                    ) : (
                      <span className="text-on-surface-variant">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── gold ────────────────────────────────────────────────────────────────────

function GoldVault({
  snapshot,
  onEdit,
  onAdd,
  onError,
  onSaved,
}: {
  snapshot: WealthSnapshot;
  onEdit: (g: GoldItemRow) => void;
  onAdd: () => void;
  onError: (m: string | null) => void;
  onSaved: () => void;
}) {
  const [rate, setRate] = useState(String(snapshot.gold.ratePerGram || ""));
  const [saving, setSaving] = useState(false);
  // Categories start collapsed: 50 pieces listed flat is a scroll box nobody
  // reads, and the category totals are what the card is for.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(category: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  const byCategory = useMemo(() => {
    const map = new Map<string, GoldItemRow[]>();
    for (const g of snapshot.gold.items) {
      if (!map.has(g.category)) map.set(g.category, []);
      map.get(g.category)!.push(g);
    }
    for (const list of map.values()) list.sort((a, b) => b.grams - a.grams);
    return map;
  }, [snapshot.gold.items]);

  const scheduled = snapshot.gold.items.filter((g) => g.dueOn).length;

  const parsed = Number(rate);
  const liveRate = Number.isFinite(parsed) && parsed > 0 ? parsed : snapshot.gold.ratePerGram;
  const dirty = liveRate !== snapshot.gold.ratePerGram;
  const maxGrams = Math.max(...snapshot.gold.byCategory.map((c) => c.grams), 1);

  async function saveRate() {
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setSaving(true);
    onError(null);
    const res = await call("/api/wealth/settings", "PATCH", { goldRatePerGram: parsed });
    setSaving(false);
    if (!res.ok) onError(res.message);
    else onSaved();
  }

  return (
    <Card
      title="Gold vault"
      note={`${snapshot.gold.totalGrams.toLocaleString("en-IN")} g`}
      action={
        <button type="button" className={secondaryBtn} onClick={onAdd}>
          Add
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-sm bg-primary-fixed/30 border border-primary-fixed rounded-lg px-md py-sm mb-md">
        <span className="text-label-sm text-accent font-semibold">Rate ₹</span>
        <input
          className="w-28 h-8 px-sm rounded border border-outline-variant bg-surface-container-lowest outline-none focus:border-primary tabular-nums"
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          aria-label="Gold rate per gram"
        />
        <span className="text-label-sm text-accent">/g →</span>
        <b className="text-body-md text-accent tabular-nums">
          {inrCompact(snapshot.gold.totalGrams * liveRate)}
        </b>
        {dirty && (
          <button type="button" className={secondaryBtn + " h-8 px-md ml-auto"} onClick={saveRate} disabled={saving}>
            {saving ? "Saving…" : "Save rate"}
          </button>
        )}
      </div>

      {snapshot.gold.ratePerGram === 0 && (
        <p className="text-caption text-on-surface-variant mb-md">
          Until a rate is saved, gold counts as nothing toward net worth.
        </p>
      )}

      {snapshot.gold.byCategory.length === 0 ? (
        <p className="text-body-md text-on-surface-variant py-md text-center">Nothing in the vault yet.</p>
      ) : (
        <div className="divide-y divide-outline-variant">
          {snapshot.gold.byCategory.map((c) => {
            const open = expanded.has(c.category);
            const pieces = byCategory.get(c.category) ?? [];
            return (
              <div key={c.category}>
                <button
                  type="button"
                  onClick={() => toggle(c.category)}
                  aria-expanded={open}
                  className="w-full text-left py-sm grid grid-cols-[20px_minmax(0,1fr)_64px_96px] items-center gap-sm hover:bg-surface-container-low rounded"
                >
                  <span
                    className="material-symbols-outlined text-on-surface-variant transition-transform"
                    style={{ fontSize: 20, transform: open ? "rotate(90deg)" : undefined }}
                    aria-hidden="true"
                  >
                    chevron_right
                  </span>
                  <span>
                    <span className="text-body-md">{c.category}</span>
                    <span className="text-caption text-on-surface-variant ml-xs">
                      {pieces.length} piece{pieces.length === 1 ? "" : "s"}
                    </span>
                    <span
                      className="block h-[5px] rounded-full bg-amber-700/80 mt-xs"
                      style={{ width: `${Math.max(4, (c.grams / maxGrams) * 100)}%` }}
                    />
                  </span>
                  <span className="text-caption text-on-surface-variant text-right tabular-nums">
                    {c.grams} g
                  </span>
                  <span className="text-body-md font-semibold text-right tabular-nums">
                    {inrCompact(c.grams * liveRate)}
                  </span>
                </button>

                {open && (
                  <ul className="pb-sm">
                    {pieces.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => onEdit(g)}
                          className="w-full text-left pl-[28px] pr-sm py-xs grid grid-cols-[minmax(0,1fr)_56px_28px] items-center gap-sm rounded hover:bg-primary-fixed/20"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-body-md">{g.name}</span>
                            {(g.dueOn || g.holderLabel !== "Self") && (
                              <span className="block text-caption text-on-surface-variant truncate">
                                {[
                                  g.holderLabel !== "Self" ? g.holderLabel : null,
                                  g.dueOn ? `due ${prettyDate(g.dueOn)}` : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            )}
                          </span>
                          <span className="text-body-md text-right tabular-nums">{g.grams} g</span>
                          <span
                            className="material-symbols-outlined text-on-surface-variant justify-self-end"
                            style={{ fontSize: 16 }}
                            aria-hidden="true"
                          >
                            edit
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {snapshot.gold.items.length > 0 && (
        <p className="mt-md text-caption text-on-surface-variant">
          Open a category to edit any piece.
          {scheduled > 0 &&
            ` ${scheduled} scheme instalment${scheduled === 1 ? "" : "s"} carr${scheduled === 1 ? "ies" : "y"} a delivery date.`}
        </p>
      )}

    </Card>
  );
}

// ── liabilities & protection ────────────────────────────────────────────────

function LiabilityList({
  liabilities,
  total,
  onOpen,
}: {
  liabilities: LiabilityRow[];
  total: number;
  onOpen: (l: LiabilityRow) => void;
}) {
  if (liabilities.length === 0) {
    return <p className="text-body-md text-on-surface-variant py-lg text-center">Nothing owed.</p>;
  }
  return (
    <div className="space-y-sm">
      {liabilities.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => onOpen(l)}
          className={
            "w-full text-left border border-outline-variant rounded-lg px-md py-sm hover:bg-surface-container-low transition " +
            (l.isClosed ? "opacity-60" : "")
          }
        >
          <div className="flex items-baseline gap-sm">
            <b className="text-body-md text-on-surface">{l.name}</b>
            <span
              className={
                "ml-auto text-body-lg font-bold tabular-nums " +
                (l.isClosed ? "text-green-700" : "text-error")
              }
            >
              {l.isClosed ? "Closed" : inrCompact(l.outstanding)}
            </span>
          </div>
          <div className="h-[5px] rounded-full bg-surface-container my-sm overflow-hidden">
            <div
              className="h-full bg-error/75"
              style={{ width: `${total > 0 ? (l.outstanding / total) * 100 : 0}%` }}
            />
          </div>
          <div className="text-caption text-on-surface-variant">
            {LIABILITY_KIND_LABEL[l.kind]}
            {l.lender ? ` · ${l.lender}` : ""}
            {l.emiAmount ? ` · EMI ${inrFull(l.emiAmount)}` : ""}
            {l.missingFields.length > 0 && !l.isClosed && (
              <span className="text-amber-700"> · add {l.missingFields.join(", ")}</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function ProtectionList({
  holdings,
  cover,
  gap,
  liabilities,
  onOpen,
}: {
  holdings: HoldingRow[];
  cover: number;
  gap: number;
  liabilities: number;
  onOpen: (h: HoldingRow) => void;
}) {
  const policies = holdings.filter((h) => h.assetClass === "protection" || h.sumAssured);
  if (policies.length === 0) {
    return (
      <p className="text-body-md text-on-surface-variant py-lg text-center">
        No protection policies recorded. Add one with class “Protection (cover only)”.
      </p>
    );
  }
  return (
    <div className="space-y-sm">
      {policies.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onOpen(p)}
          className="w-full text-left border border-outline-variant rounded-lg px-md py-sm hover:bg-surface-container-low transition"
        >
          <div className="flex items-baseline gap-sm">
            <b className="text-body-md text-on-surface truncate">{p.name}</b>
            <span className="ml-auto">
              {p.sumAssured ? (
                <Chip tone="good">Cover {inrCompact(p.sumAssured)}</Chip>
              ) : (
                <Chip>No cover recorded</Chip>
              )}
            </span>
          </div>
          <div className="text-caption text-on-surface-variant mt-xs">
            {[p.institution, p.contributionAmount ? `${inrFull(p.contributionAmount)} ${p.frequency.replace("_", " ")}` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </button>
      ))}

      {cover > 0 && liabilities > 0 && (
        <p
          className={
            "text-body-md rounded-lg px-md py-sm border " +
            (gap < 0
              ? "bg-error-container/40 border-error/30 text-on-error-container"
              : "bg-green-50 border-green-200 text-green-800")
          }
        >
          {gap < 0 ? (
            <>
              <b>Term cover is {inrCompact(Math.abs(gap))} short of total debt.</b> {inrCompact(cover)} of
              cover against {inrCompact(liabilities)} owed — before any income-replacement goal.
            </>
          ) : (
            <>
              <b>Cover clears the debt.</b> {inrCompact(cover)} against {inrCompact(liabilities)} owed.
            </>
          )}
        </p>
      )}
    </div>
  );
}

// ── empty state ─────────────────────────────────────────────────────────────

function EmptyDesk({ onAdd, onAddLiability }: { onAdd: () => void; onAddLiability: () => void }) {
  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm px-lg py-xl text-center max-w-2xl mx-auto">
      <span className="material-symbols-outlined text-accent" style={{ fontSize: 40 }}>
        savings
      </span>
      <h3 className="text-h2 text-on-surface mt-sm">Your wealth desk is empty</h3>
      <p className="text-body-lg text-on-surface-variant mt-sm">
        Add what you own and what you owe, and this page starts tracking net worth, allocation and every
        renewal date for you. Nothing here is visible to anyone else — every row is tied to your own
        login.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-sm mt-lg">
        <button type="button" className={primaryBtn} onClick={onAdd}>
          Add your first holding
        </button>
        <button type="button" className={secondaryBtn} onClick={onAddLiability}>
          Add a loan
        </button>
      </div>
      <p className="text-caption text-on-surface-variant mt-lg">
        Bringing a spreadsheet across? Run{" "}
        <code className="bg-surface-container px-xs rounded">npm run wealth:import</code> locally — it
        reads the file on your machine and never puts it in the repository.
      </p>
    </section>
  );
}

// ── drawers ─────────────────────────────────────────────────────────────────

function Editors({
  drawer,
  setDrawer,
  snapshot,
  onSaved,
}: {
  drawer: DrawerState;
  setDrawer: (d: DrawerState) => void;
  snapshot: WealthSnapshot;
  onSaved: () => void;
}) {
  return (
    <>
      {drawer.kind === "holding" && (
        <HoldingDrawer
          holding={drawer.holding}
          snapshot={snapshot}
          onClose={() => setDrawer({ kind: "none" })}
          onSaved={onSaved}
        />
      )}
      {drawer.kind === "liability" && (
        <LiabilityDrawer
          liability={drawer.liability}
          onClose={() => setDrawer({ kind: "none" })}
          onSaved={onSaved}
        />
      )}
      {drawer.kind === "gold" && (
        <GoldDrawer
          item={drawer.item}
          categories={snapshot.gold.byCategory.map((c) => c.category)}
          onClose={() => setDrawer({ kind: "none" })}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function HoldingDrawer({
  holding,
  snapshot,
  onClose,
  onSaved,
}: {
  holding: HoldingRow | null;
  snapshot: WealthSnapshot;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<HoldingDraft>(() =>
    holding ? draftFromHolding(holding, snapshot.today) : emptyHoldingDraft(snapshot.today),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);

  const set = <K extends keyof HoldingDraft>(key: K, value: HoldingDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function reveal() {
    if (!holding) return;
    setRevealBusy(true);
    setError(null);
    const res = await call(`/api/wealth/holdings/${holding.id}/secret`, "POST");
    setRevealBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setRevealed(String(res.data.password ?? ""));
    // Clear it from the screen after half a minute — a revealed password
    // sitting in an open tab is the thing the vault exists to avoid.
    window.setTimeout(() => setRevealed(null), 30_000);
  }

  async function save() {
    if (!draft.name.trim()) {
      setError("Give the holding a name.");
      return;
    }
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      name: draft.name.trim(),
      assetClass: draft.assetClass,
      scope: draft.scope,
      holderLabel: draft.holderLabel.trim() || "Self",
      institution: textOrNull(draft.institution),
      policyNo: textOrNull(draft.policyNo),
      contributionAmount: numOrNull(draft.contributionAmount),
      frequency: draft.frequency,
      dueDayOfMonth: draft.frequency === "monthly" ? intOrNull(draft.dueDayOfMonth) : null,
      renewalOn: draft.frequency === "monthly" || draft.frequency === "none" ? null : textOrNull(draft.renewalOn),
      sumAssured: numOrNull(draft.sumAssured),
      reminderLeadDays: draft.reminderLeadDays,
      portalUrl: draft.portalUrl.trim(),
      portalUsername: draft.portalUsername.trim(),
      notes: textOrNull(draft.notes),
    };

    // Only send the password when it was actually typed: an untouched field
    // must not wipe a stored one.
    if (draft.portalPassword !== "") body.portalPassword = draft.portalPassword;

    const value = numOrNull(draft.value);
    if (draft.assetClass !== "protection" && value !== null) {
      body.value = value;
      body.valuedOn = draft.valuedOn || snapshot.today;
    }

    const res = holding
      ? await call(`/api/wealth/holdings/${holding.id}`, "PATCH", body)
      : await call("/api/wealth/holdings", "POST", body);
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    onSaved();
  }

  async function archive() {
    if (!holding) return;
    setSaving(true);
    const res = await call(`/api/wealth/holdings/${holding.id}`, "DELETE");
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    onSaved();
  }

  return (
    <Drawer
      open
      eyebrow={holding ? ASSET_CLASS_META[holding.assetClass].label : "New holding"}
      title={holding ? holding.name : "Add a holding"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={primaryBtn} onClick={save} disabled={saving}>
            {saving ? "Saving…" : holding ? "Save changes" : "Add holding"}
          </button>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {holding && (
            <button
              type="button"
              onClick={archive}
              disabled={saving}
              className="ml-auto h-10 px-md rounded-lg text-error hover:bg-error-container/40 text-label-sm font-semibold"
            >
              Archive
            </button>
          )}
        </>
      }
    >
      <ErrorNote message={error} />
      <HoldingForm
        draft={draft}
        set={set}
        holding={holding}
        secretVaultConfigured={snapshot.secretVaultConfigured}
        onReveal={reveal}
        revealed={revealed}
        revealBusy={revealBusy}
      />
      {holding?.valuedOn && (
        <div>
          <p className="text-label-sm uppercase tracking-wider text-on-surface-variant mb-xs">
            Latest valuation
          </p>
          <div className="flex justify-between text-body-md border-b border-outline-variant py-xs">
            <span>{prettyDate(holding.valuedOn)}</span>
            <b className="tabular-nums">{inrFull(holding.value)}</b>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function LiabilityDrawer({
  liability,
  onClose,
  onSaved,
}: {
  liability: LiabilityRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<LiabilityDraft>(() =>
    liability ? draftFromLiability(liability) : emptyLiabilityDraft(),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof LiabilityDraft>(key: K, value: LiabilityDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    if (!draft.name.trim()) {
      setError("Give the borrowing a name.");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: draft.name.trim(),
      kind: draft.kind,
      scope: draft.scope,
      lender: textOrNull(draft.lender),
      outstanding: numOrNull(draft.outstanding) ?? 0,
      interestRate: numOrNull(draft.interestRate),
      emiAmount: numOrNull(draft.emiAmount),
      emiDayOfMonth: intOrNull(draft.emiDayOfMonth),
      tenureMonths: intOrNull(draft.tenureMonths),
      startedOn: textOrNull(draft.startedOn),
      notes: textOrNull(draft.notes),
      closed: draft.closed,
    };
    const res = liability
      ? await call(`/api/wealth/liabilities/${liability.id}`, "PATCH", body)
      : await call("/api/wealth/liabilities", "POST", body);
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    onSaved();
  }

  async function remove() {
    if (!liability) return;
    setSaving(true);
    const res = await call(`/api/wealth/liabilities/${liability.id}`, "DELETE");
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    onSaved();
  }

  return (
    <Drawer
      open
      eyebrow={liability ? "Borrowing" : "New borrowing"}
      title={liability ? liability.name : "Add a loan"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={primaryBtn} onClick={save} disabled={saving}>
            {saving ? "Saving…" : liability ? "Save changes" : "Add loan"}
          </button>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {liability && (
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              className="ml-auto h-10 px-md rounded-lg text-error hover:bg-error-container/40 text-label-sm font-semibold"
            >
              Delete
            </button>
          )}
        </>
      }
    >
      <ErrorNote message={error} />
      <LiabilityForm draft={draft} set={set} />
    </Drawer>
  );
}

function GoldDrawer({
  item,
  categories,
  onClose,
  onSaved,
}: {
  item: GoldItemRow | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<GoldDraft>(() => (item ? draftFromGold(item) : emptyGoldDraft()));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof GoldDraft>(key: K, value: GoldDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    if (!draft.name.trim() || !draft.category.trim()) {
      setError("A piece needs both a category and a name.");
      return;
    }
    const grams = numOrNull(draft.grams);
    if (grams === null) {
      setError("Enter the weight in grams.");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      category: draft.category.trim(),
      name: draft.name.trim(),
      grams,
      holderLabel: draft.holderLabel.trim() || "Self",
      purityKarat: intOrNull(draft.purityKarat),
      dueOn: textOrNull(draft.dueOn),
      notes: textOrNull(draft.notes),
    };
    const res = item
      ? await call(`/api/wealth/gold/${item.id}`, "PATCH", body)
      : await call("/api/wealth/gold", "POST", body);
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    onSaved();
  }

  async function remove() {
    if (!item) return;
    setSaving(true);
    const res = await call(`/api/wealth/gold/${item.id}`, "DELETE");
    setSaving(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    onClose();
    onSaved();
  }

  return (
    <Drawer
      open
      eyebrow={item ? "Gold" : "New piece"}
      title={item ? item.name : "Add to the vault"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={primaryBtn} onClick={save} disabled={saving}>
            {saving ? "Saving…" : item ? "Save changes" : "Add piece"}
          </button>
          <button type="button" className={secondaryBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {item && (
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              className="ml-auto h-10 px-md rounded-lg text-error hover:bg-error-container/40 text-label-sm font-semibold"
            >
              Remove
            </button>
          )}
        </>
      }
    >
      <ErrorNote message={error} />
      <GoldForm draft={draft} set={set} categories={categories} />
    </Drawer>
  );
}
