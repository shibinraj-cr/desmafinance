"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  COMMITMENT_KINDS,
  COMMITMENT_KIND_LABELS,
  FY_MONTHS,
  MKT_PLANNER_HREF,
  formatInr,
  formatThousands,
  parseRupees,
  type Attribution,
  type CommitmentKind,
} from "@/lib/mkt-planner-shared";
import { plannerApi } from "../_api";
import { Card, faintText, ghostBtnClass, ghostBtnStyle, inputClass, inputStyle, mutedText, primaryBtnClass, primaryBtnStyle } from "../_ui";

type MatrixRow = { id: string; name: string; monthly: number[]; spentMonthly: number[]; budget: number; spent: number };
type LedgerRow = {
  id: string;
  date: string;
  subItem: string;
  description: string | null;
  partyName: string | null;
  paymentMode: string;
  amount: number;
  attr: Attribution;
};
type Realloc = {
  id: string;
  from: string;
  fromMonthIdx: number;
  to: string;
  toMonthIdx: number;
  amount: number;
  reason: string | null;
  status: string;
  requestedBy: string | null;
  createdAt: string;
};

const NOW_BG = "rgba(250, 204, 21, 0.08)";
const th = "px-[10px] py-[9px] text-[11px] font-semibold uppercase tracking-wider border-b whitespace-nowrap";
const rowBorder = { borderColor: "var(--lp-surface-container-high)" };
const headBorder = { ...faintText, borderColor: "var(--lp-outline-variant)" };
const NOT_A_CAMPAIGN = "__none__";
const AUTOMATIC = "";

function niceDate(ds: string): string {
  return new Date(`${ds}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function BudgetClient(props: {
  fy: number;
  admin: boolean;
  nowIdx: number;
  rows: MatrixRow[];
  unmapped: number[] | null;
  planMonthly: number[];
  spentMonthly: number[];
  channels: { id: string; name: string }[];
  channelName: Record<string, string>;
  campaignName: Record<string, string>;
  campaignOptions: { id: string; name: string; channelId: string | null; startDate: string | null }[];
  lines: { id: string; campaignId: string; label: string }[];
  ledger: LedgerRow[];
  lineNames: Record<string, string>;
  reallocations: Realloc[];
  initialView: "all" | "review";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      {error && (
        <p role="alert" className="text-[13px] rounded-[8px] px-[12px] py-[8px]" style={{ backgroundColor: "rgba(255, 180, 171, 0.08)", color: "var(--lp-error)" }}>
          {error}
        </p>
      )}
      <Matrix {...props} run={run} busy={busy} />
      <div className="flex flex-wrap gap-[16px] items-start">
        <Ledger {...props} run={run} busy={busy} />
        <aside className="flex-[1_1_360px] min-w-0 flex flex-col gap-[16px]">
          <Reallocations {...props} run={run} busy={busy} />
          <LogCommitment {...props} run={run} busy={busy} />
        </aside>
      </div>
    </div>
  );
}

type Run = { run: (fn: () => Promise<unknown>) => Promise<boolean>; busy: boolean };

function Matrix({
  fy,
  admin,
  nowIdx,
  rows,
  unmapped,
  planMonthly,
  spentMonthly,
  run,
  busy,
}: Parameters<typeof BudgetClient>[0] & Run) {
  const [edit, setEdit] = useState<null | { channelId: string; monthIdx: number; value: string }>(null);
  // Set once a cell's edit has been settled (saved or escaped), so the blur
  // that follows the input unmounting can't save it a second time — or save
  // an edit the user just abandoned with Escape.
  const settled = useRef(false);

  async function saveCell() {
    if (!edit || settled.current) return;
    settled.current = true;
    const amount = parseRupees(edit.value || "0");
    const cell = edit;
    setEdit(null);
    if (amount === null) return;
    await run(() => plannerApi("PUT", "/api/marketing/planner/allocations", { fy, cells: [{ channelId: cell.channelId, monthIdx: cell.monthIdx, amount }] }));
  }

  async function spread(row: MatrixRow) {
    const raw = window.prompt(`Yearly budget for ${row.name}, in rupees. It is split evenly across the twelve months (any remainder goes to March).`, String(row.budget || ""));
    if (raw === null) return;
    const total = parseRupees(raw);
    if (total === null) return window.alert("Enter a whole rupee amount, like 18,00,000.");
    const each = Math.floor(total / 12);
    const cells = Array.from({ length: 12 }, (_, i) => ({ channelId: row.id, monthIdx: i, amount: i === 11 ? total - each * 11 : each }));
    await run(() => plannerApi("PUT", "/api/marketing/planner/allocations", { fy, cells }));
  }

  const showActual = (i: number) => i <= nowIdx;
  const totalPlan = planMonthly.reduce((a, b) => a + b, 0);
  const totalSpent = spentMonthly.reduce((a, b) => a + b, 0);

  return (
    <Card
      title="Allocation by channel and month"
      subtitle={
        admin
          ? "₹ thousand. Months that have started show actual spend over plan. Click any cell to set its plan (in rupees); Spread sets a whole year at once."
          : "₹ thousand. Months that have started show actual spend over plan. Only an Admin edits the plan — use a reallocation request to move money."
      }
      actions={
        <div className="flex flex-wrap gap-[14px] text-[12px]" style={mutedText}>
          <span className="inline-flex items-center gap-[6px]"><span className="text-[10px]" style={{ color: "var(--lp-orange)" }}>▲</span>Over plan</span>
          <span className="inline-flex items-center gap-[6px]"><span className="inline-block w-[14px] h-[12px]" style={{ backgroundColor: NOW_BG, border: "1px solid rgba(250, 204, 21, 0.4)" }} />This month (to date)</span>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-[13px]" style={mutedText}>
          No channels yet.{" "}
          {admin && (
            <Link href={`${MKT_PLANNER_HREF}/channels?fy=${fy}`} style={{ color: "var(--lp-primary)" }}>
              Add channels
            </Link>
          )}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[1180px] text-[13px]">
            <thead>
              <tr>
                <th className={th} style={{ ...headBorder, textAlign: "left", minWidth: 190 }}>Channel</th>
                {FY_MONTHS.map((m, i) => (
                  <th key={m} className={th} style={{ ...headBorder, textAlign: "right", backgroundColor: i === nowIdx ? NOW_BG : undefined, color: i === nowIdx ? "var(--lp-primary)" : headBorder.color }}>
                    {m}
                  </th>
                ))}
                <th className={th} style={{ ...headBorder, textAlign: "right", borderLeft: "1px solid var(--lp-outline-variant)" }}>FY plan</th>
                <th className={th} style={{ ...headBorder, textAlign: "right" }}>Spent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-[10px] py-[8px] border-b font-medium" style={rowBorder}>{r.name}</td>
                  {FY_MONTHS.map((m, i) => {
                    const plan = r.monthly[i];
                    const spent = r.spentMonthly[i];
                    const over = showActual(i) && spent > plan;
                    const editingThis = edit?.channelId === r.id && edit.monthIdx === i;
                    return (
                      <td key={m} className="px-[8px] py-[6px] border-b text-right align-middle" style={{ ...rowBorder, backgroundColor: i === nowIdx ? NOW_BG : undefined }}>
                        {editingThis ? (
                          <input
                            aria-label={`${r.name} ${m} plan in rupees`}
                            autoFocus
                            className="w-[90px] rounded-[6px] px-[6px] py-[4px] text-[12px] border outline-none font-mono text-right"
                            style={inputStyle}
                            value={edit.value}
                            onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                            onBlur={saveCell}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveCell();
                              if (e.key === "Escape") {
                                settled.current = true;
                                setEdit(null);
                              }
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            disabled={!admin || busy}
                            onClick={() => {
                              settled.current = false;
                              setEdit({ channelId: r.id, monthIdx: i, value: String(plan) });
                            }}
                            title={showActual(i) ? `${m}: spent ${formatInr(spent)} of ${formatInr(plan)} plan` : `${m} plan: ${formatInr(plan)}`}
                            className="w-full text-right disabled:cursor-default"
                          >
                            {showActual(i) ? (
                              <>
                                <span className="block font-mono" style={{ color: over ? "var(--lp-orange)" : "var(--lp-on-surface)" }}>
                                  {formatThousands(spent)}
                                  {over && <span className="text-[9px] ml-[3px]">▲</span>}
                                </span>
                                <span className="block font-mono text-[10px]" style={faintText}>of {formatThousands(plan)}</span>
                              </>
                            ) : (
                              <span className="font-mono" style={{ color: "var(--lp-on-surface-variant)", borderBottom: admin ? "1px dashed var(--lp-outline)" : undefined }}>
                                {formatThousands(plan)}
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-[10px] py-[8px] border-b text-right font-mono font-medium" style={{ ...rowBorder, borderLeft: "1px solid var(--lp-outline-variant)" }}>
                    <span className="block">{formatThousands(r.budget)}</span>
                    {admin && (
                      <button type="button" disabled={busy} onClick={() => spread(r)} className="text-[11px] font-sans font-semibold" style={{ color: "var(--lp-primary)" }}>
                        Spread
                      </button>
                    )}
                  </td>
                  <td className="px-[10px] py-[8px] border-b text-right font-mono" style={{ ...rowBorder, ...mutedText }}>{formatThousands(r.spent)}</td>
                </tr>
              ))}
              {unmapped && unmapped.some((v) => v > 0) && (
                <tr>
                  <td className="px-[10px] py-[8px] border-b" style={{ ...rowBorder, ...mutedText }}>Not mapped to a channel</td>
                  {FY_MONTHS.map((m, i) => (
                    <td key={m} className="px-[8px] py-[6px] border-b text-right font-mono" style={{ ...rowBorder, ...mutedText, backgroundColor: i === nowIdx ? NOW_BG : undefined }}>
                      {showActual(i) && unmapped[i] ? formatThousands(unmapped[i]) : ""}
                    </td>
                  ))}
                  <td className="px-[10px] py-[8px] border-b text-right font-mono" style={{ ...rowBorder, borderLeft: "1px solid var(--lp-outline-variant)" }}>—</td>
                  <td className="px-[10px] py-[8px] border-b text-right font-mono" style={{ ...rowBorder, ...mutedText }}>{formatThousands(unmapped.reduce((a, b) => a + b, 0))}</td>
                </tr>
              )}
              <tr>
                <td className="px-[10px] py-[8px] font-semibold">All channels</td>
                {FY_MONTHS.map((m, i) => (
                  <td key={m} className="px-[8px] py-[6px] text-right" style={{ backgroundColor: i === nowIdx ? NOW_BG : undefined }}>
                    {showActual(i) ? (
                      <>
                        <span className="block font-mono font-medium">{formatThousands(spentMonthly[i])}</span>
                        <span className="block font-mono text-[10px]" style={faintText}>of {formatThousands(planMonthly[i])}</span>
                      </>
                    ) : (
                      <span className="font-mono font-medium">{formatThousands(planMonthly[i])}</span>
                    )}
                  </td>
                ))}
                <td className="px-[10px] py-[8px] text-right font-mono font-semibold" style={{ borderLeft: "1px solid var(--lp-outline-variant)" }}>{formatThousands(totalPlan)}</td>
                <td className="px-[10px] py-[8px] text-right font-mono font-semibold">{formatThousands(totalSpent)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Ledger({
  ledger,
  channelName,
  campaignName,
  campaignOptions,
  lineNames,
  initialView,
  run,
  busy,
}: Parameters<typeof BudgetClient>[0] & Run) {
  const [view, setView] = useState<"all" | "review">(initialView);
  const [limit, setLimit] = useState(100);
  const review = ledger.filter((r) => r.attr.mode === "review");
  const shown = (view === "review" ? review : ledger).slice(0, limit);
  const total = view === "review" ? review.length : ledger.length;

  const sortedOptions = useMemo(() => [...campaignOptions].sort((a, b) => a.name.localeCompare(b.name)), [campaignOptions]);

  async function setTag(row: LedgerRow, value: string) {
    if (value === AUTOMATIC) {
      await run(() => plannerApi("DELETE", `/api/marketing/planner/spend-tags?transactionId=${encodeURIComponent(row.id)}`));
    } else {
      await run(() =>
        plannerApi("PUT", "/api/marketing/planner/spend-tags", {
          transactionId: row.id,
          campaignId: value === NOT_A_CAMPAIGN ? null : value,
        }),
      );
    }
  }

  const describe = (r: LedgerRow): { text: string; sub: string; warn?: boolean } => {
    const a = r.attr;
    if (a.mode === "tagged") {
      return a.campaignId
        ? { text: campaignName[a.campaignId] ?? "Campaign", sub: `Tagged${a.lineId && lineNames[a.lineId] ? ` · ${lineNames[a.lineId]}` : ""}` }
        : { text: "Not a campaign", sub: "Marked as channel spend" };
    }
    if (a.mode === "auto") return { text: campaignName[a.campaignId] ?? "Campaign", sub: "Auto · only campaign running on this channel" };
    if (a.mode === "channel") return { text: "Channel spend", sub: "No campaign was running on this channel" };
    return a.reason === "unmapped"
      ? { text: "Needs a campaign", sub: "No channel claims this sub-item", warn: true }
      : { text: "Needs a campaign", sub: `${a.candidates.length} campaigns on this channel were running`, warn: true };
  };

  return (
    <Card
      className="flex-[999_1_560px]"
      title="Marketing payments from the finance ledger"
      subtitle="Every Expense row under Marketing this year. Rules match most of them; tag the rest. The ledger itself is never edited here."
      actions={
        <div role="group" aria-label="Filter payments" className="flex rounded-[8px] border p-[3px]" style={{ borderColor: "var(--lp-outline-variant)", backgroundColor: "var(--lp-surface-container-low)" }}>
          {(["all", "review"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className="min-h-[34px] px-[12px] rounded-[6px] text-[12px]"
              style={{
                backgroundColor: view === v ? "var(--lp-surface-container-high)" : "transparent",
                color: view === v ? (v === "review" ? "var(--lp-orange)" : "var(--lp-primary)") : "var(--lp-on-surface-variant)",
                fontWeight: view === v ? 600 : 400,
              }}
            >
              {v === "all" ? `All · ${ledger.length}` : `Needs a campaign · ${review.length}`}
            </button>
          ))}
        </div>
      }
    >
      {shown.length === 0 ? (
        <p className="text-[13px]" style={mutedText}>
          {view === "review" ? "Every Marketing payment is accounted for." : "No Marketing expense rows in the ledger for this year yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[880px] text-[13px]">
            <thead>
              <tr>
                {["Date", "Description · sub-item", "Paid via", "Amount", "Channel", "Campaign"].map((h, i) => (
                  <th key={h} className={th} style={{ ...headBorder, textAlign: i === 3 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const d = describe(r);
                const a = r.attr;
                const candidates = a.mode === "review" ? a.candidates : [];
                const current = a.mode === "tagged" ? (a.campaignId ?? NOT_A_CAMPAIGN) : "";
                return (
                  <tr key={r.id} style={{ backgroundColor: d.warn ? "rgba(255, 182, 147, 0.06)" : undefined }}>
                    <td className="px-[10px] py-[10px] border-b font-mono whitespace-nowrap" style={{ ...rowBorder, ...mutedText }}>{niceDate(r.date)}</td>
                    <td className="px-[10px] py-[10px] border-b" style={rowBorder}>
                      <span className="block">{r.description || r.subItem}</span>
                      <span className="block text-[11px]" style={faintText}>{r.subItem}{r.partyName ? ` · ${r.partyName}` : ""}</span>
                    </td>
                    <td className="px-[10px] py-[10px] border-b whitespace-nowrap" style={{ ...rowBorder, ...mutedText }}>{r.paymentMode}</td>
                    <td className="px-[10px] py-[10px] border-b text-right font-mono whitespace-nowrap" style={rowBorder}>{formatInr(r.amount)}</td>
                    <td className="px-[10px] py-[10px] border-b whitespace-nowrap" style={{ ...rowBorder, ...mutedText }}>{a.channelId ? (channelName[a.channelId] ?? "—") : "Not mapped"}</td>
                    <td className="px-[10px] py-[10px] border-b" style={rowBorder}>
                      <span className="block text-[13px]" style={{ color: d.warn ? "var(--lp-orange)" : undefined }}>
                        {a.campaignId ? (
                          <Link href={`${MKT_PLANNER_HREF}/campaigns/${a.campaignId}`} style={{ color: "var(--lp-on-surface)" }}>{d.text}</Link>
                        ) : (
                          d.text
                        )}
                      </span>
                      <span className="block text-[11px] mb-[4px]" style={faintText}>{d.sub}</span>
                      <select
                        aria-label="Tag to campaign"
                        disabled={busy}
                        value={current}
                        onChange={(e) => setTag(r, e.target.value)}
                        className="rounded-[8px] px-[8px] min-h-[34px] text-[12px] border outline-none w-[230px]"
                        style={{ ...inputStyle, borderColor: d.warn ? "var(--lp-orange)" : "var(--lp-outline-variant)" }}
                      >
                        <option value={AUTOMATIC}>{a.mode === "tagged" ? "Automatic (remove tag)" : "Change…"}</option>
                        {candidates.length > 0 && (
                          <optgroup label="Running on this channel">
                            {candidates.map((id) => <option key={id} value={id}>{campaignName[id] ?? id}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="All campaigns">
                          {sortedOptions.filter((o) => !candidates.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </optgroup>
                        <option value={NOT_A_CAMPAIGN}>Not a campaign (channel spend)</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {total > shown.length && (
        <button type="button" onClick={() => setLimit(limit + 100)} className={ghostBtnClass} style={ghostBtnStyle}>
          Show more ({total - shown.length} left)
        </button>
      )}
    </Card>
  );
}

function Reallocations({ fy, admin, channels, rows, reallocations, run, busy }: Parameters<typeof BudgetClient>[0] & Run) {
  const [f, setF] = useState({ fromChannelId: "", fromMonthIdx: "", toChannelId: "", toMonthIdx: "", amount: "", reason: "" });
  const [err, setErr] = useState<string | null>(null);
  const pending = reallocations.filter((r) => r.status === "pending");
  const recent = reallocations.filter((r) => r.status !== "pending").slice(0, 5);
  const available =
    f.fromChannelId && f.fromMonthIdx !== "" ? rows.find((r) => r.id === f.fromChannelId)?.monthly[Number(f.fromMonthIdx)] ?? 0 : null;

  async function submit() {
    setErr(null);
    const amount = parseRupees(f.amount);
    if (!f.fromChannelId || f.fromMonthIdx === "" || !f.toChannelId || f.toMonthIdx === "") return setErr("Pick where the money comes from and where it goes.");
    if (!amount) return setErr("Enter the amount in whole rupees.");
    const ok = await run(() =>
      plannerApi("POST", "/api/marketing/planner/reallocations", {
        fy,
        fromChannelId: f.fromChannelId,
        fromMonthIdx: Number(f.fromMonthIdx),
        toChannelId: f.toChannelId,
        toMonthIdx: Number(f.toMonthIdx),
        amount,
        reason: f.reason.trim() || undefined,
      }),
    );
    if (ok) setF({ fromChannelId: "", fromMonthIdx: "", toChannelId: "", toMonthIdx: "", amount: "", reason: "" });
  }

  const sel = (label: string, value: string, onChange: (v: string) => void, opts: [string, string][]) => (
    <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
      {label}
      <select className={inputClass} style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick…</option>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  const chOpts = channels.map((c) => [c.id, c.name] as [string, string]);
  const mOpts = FY_MONTHS.map((m, i) => [String(i), m] as [string, string]);

  return (
    <Card title="Budget moves" subtitle={admin ? "Requests to move money between channels and months. Approving moves it in the grid." : "Ask an Admin to move money between channels or months."}>
      {pending.length === 0 && recent.length === 0 && (
        <p className="text-[13px]" style={mutedText}>No requests this year.</p>
      )}
      {pending.map((r) => (
        <div key={r.id} className="rounded-[10px] border p-[12px] flex flex-col gap-[8px]" style={{ borderColor: "var(--lp-outline-variant)", backgroundColor: "var(--lp-surface-container-low)" }}>
          <div className="flex justify-between gap-[8px] items-baseline">
            <span className="font-mono text-[18px]">{formatInr(r.amount)}</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--lp-orange)" }}>Awaiting Admin</span>
          </div>
          <p className="text-[13px]">
            {r.from} ({FY_MONTHS[r.fromMonthIdx]}) → {r.to} ({FY_MONTHS[r.toMonthIdx]})
          </p>
          {r.reason && <p className="text-[12px]" style={mutedText}>&ldquo;{r.reason}&rdquo;{r.requestedBy ? ` — ${r.requestedBy}` : ""}</p>}
          {admin && (
            <div className="flex gap-[8px]">
              <button type="button" disabled={busy} onClick={() => run(() => plannerApi("POST", `/api/marketing/planner/reallocations/${r.id}`, { decision: "approve" }))} className={`${primaryBtnClass} flex-1`} style={primaryBtnStyle}>
                Approve
              </button>
              <button type="button" disabled={busy} onClick={() => run(() => plannerApi("POST", `/api/marketing/planner/reallocations/${r.id}`, { decision: "reject" }))} className={`${ghostBtnClass} flex-1`} style={ghostBtnStyle}>
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
      {recent.length > 0 && (
        <ul className="flex flex-col gap-[6px]">
          {recent.map((r) => (
            <li key={r.id} className="text-[12px] flex justify-between gap-[8px]" style={mutedText}>
              <span className="truncate">{r.from} → {r.to} · {FY_MONTHS[r.toMonthIdx]}</span>
              <span className="shrink-0 font-mono">{formatInr(r.amount)} · {r.status}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t pt-[12px] grid grid-cols-2 gap-[10px]" style={rowBorder}>
        {sel("From channel", f.fromChannelId, (v) => setF({ ...f, fromChannelId: v }), chOpts)}
        {sel("From month", f.fromMonthIdx, (v) => setF({ ...f, fromMonthIdx: v }), mOpts)}
        {sel("To channel", f.toChannelId, (v) => setF({ ...f, toChannelId: v }), chOpts)}
        {sel("To month", f.toMonthIdx, (v) => setF({ ...f, toMonthIdx: v }), mOpts)}
        <label className="flex flex-col gap-[5px] text-[12px] col-span-2" style={mutedText}>
          Amount (₹){available !== null ? ` · ${formatInr(available)} planned there` : ""}
          <input className={`${inputClass} font-mono text-right`} style={inputStyle} inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </label>
        <label className="flex flex-col gap-[5px] text-[12px] col-span-2" style={mutedText}>
          Why
          <input className={inputClass} style={inputStyle} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={1000} />
        </label>
        <button type="button" disabled={busy} onClick={submit} className={`${ghostBtnClass} col-span-2`} style={{ ...ghostBtnStyle, color: "var(--lp-primary)" }}>
          Request the move
        </button>
      </div>
      {err && <p role="alert" className="text-[13px]" style={{ color: "var(--lp-error)" }}>{err}</p>}
    </Card>
  );
}

function LogCommitment({ campaignOptions, lines, run, busy }: Parameters<typeof BudgetClient>[0] & Run) {
  const [f, setF] = useState({ campaignId: "", lineId: "", amount: "", kind: "quote" as CommitmentKind, dueDate: "", vendor: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const campaignLines = lines.filter((l) => l.campaignId === f.campaignId);

  async function save() {
    setErr(null);
    setDone(false);
    const amount = parseRupees(f.amount);
    if (!f.campaignId) return setErr("Pick the campaign it's for.");
    if (!amount) return setErr("Enter the amount promised, in whole rupees.");
    const ok = await run(() =>
      plannerApi("POST", `/api/marketing/planner/campaigns/${f.campaignId}/commitments`, {
        lineId: f.lineId || null,
        amount,
        kind: f.kind,
        dueDate: f.dueDate || null,
        vendor: f.vendor.trim() || null,
        note: f.note.trim() || null,
      }),
    );
    if (ok) {
      setF({ campaignId: f.campaignId, lineId: "", amount: "", kind: "quote", dueDate: "", vendor: "", note: "" });
      setDone(true);
    }
  }

  return (
    <Card title="Log a commitment" subtitle="Money promised but not yet paid. It nets off by itself once the matching ledger payment lands on the same budget line.">
      <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
        Campaign
        <select className={inputClass} style={inputStyle} value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value, lineId: "" })}>
          <option value="">Pick…</option>
          {campaignOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
        Budget line
        <select className={inputClass} style={inputStyle} value={f.lineId} disabled={!f.campaignId} onChange={(e) => setF({ ...f, lineId: e.target.value })}>
          <option value="">{campaignLines.length ? "No line" : "This campaign has no lines"}</option>
          {campaignLines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-[10px]">
        <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
          Amount (₹)
          <input className={`${inputClass} font-mono text-right`} style={inputStyle} inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </label>
        <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
          Due to pay
          <input type="date" className={`${inputClass} lp-date-input`} style={inputStyle} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
        </label>
      </div>
      <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
        Vendor
        <input className={inputClass} style={inputStyle} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
      </label>
      <fieldset className="flex flex-col gap-[6px]">
        <legend className="text-[12px] mb-[6px]" style={mutedText}>Kind</legend>
        <div className="flex flex-wrap gap-[6px]">
          {COMMITMENT_KINDS.map((k) => (
            <label
              key={k}
              className="inline-flex items-center gap-[6px] min-h-[34px] px-[12px] rounded-full border text-[12px] cursor-pointer"
              style={{ borderColor: f.kind === k ? "var(--lp-primary)" : "var(--lp-outline-variant)", color: f.kind === k ? "var(--lp-primary)" : "var(--lp-on-surface-variant)", fontWeight: f.kind === k ? 600 : 400 }}
            >
              <input type="radio" name="commit-kind" checked={f.kind === k} onChange={() => setF({ ...f, kind: k })} style={{ accentColor: "#facc15", margin: 0 }} />
              {COMMITMENT_KIND_LABELS[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-[5px] text-[12px]" style={mutedText}>
        Note
        <input className={inputClass} style={inputStyle} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} />
      </label>
      <button type="button" disabled={busy} onClick={save} className={primaryBtnClass} style={primaryBtnStyle}>Save commitment</button>
      {err && <p role="alert" className="text-[13px]" style={{ color: "var(--lp-error)" }}>{err}</p>}
      {done && <p className="text-[13px]" style={{ color: "var(--lp-cyan)" }}>Saved.</p>}
    </Card>
  );
}
