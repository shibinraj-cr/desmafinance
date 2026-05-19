"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Range = { from: string; to: string };
type PriorSummary = {
  total: number;
  answered: number;
  failed: number;
  avgSec: number;
  ansAvgSec: number;
};
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend as ReLegend,
  BarChart,
  Bar,
  LabelList,
} from "recharts";

type Call = {
  id: string;
  slNo: number | null;
  contactName: string | null;
  sourceNumber: string | null;
  didNumber: string | null;
  cost: number | null;
  dtmfSeq: string | null;
  callStartTime: string | null;
  callStatus: string | null;
  userStatus: string | null;
  agentName: string | null;
  lastTriedName: string | null;
  firstTriedName: string | null;
  totalDurationSec: number;
  totalDurationDisplay: string | null;
  answeredDurationSec: number;
  answeredDurationDisplay: string | null;
  deptName: string | null;
  disposition: string | null;
  callRecordFile: string | null;
};

const GOLD = "#facc15";
const CYAN = "#33e4ff";
const ORANGE = "#ffb693";
const TEXT = "#d1c6ab";
const GRID = "#4d4632";

export function VoxbayClient({
  canUpload,
  latestUpload,
  calls,
  range,
  priorRange,
  prior,
}: {
  canUpload: boolean;
  latestUpload: {
    filename: string | null;
    rowCount: number;
    uploadedAt: string;
    uploadedBy: string | null;
  } | null;
  calls: Call[];
  range: Range;
  priorRange: Range;
  prior: PriorSummary;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [fromInput, setFromInput] = useState(range.from);
  const [toInput, setToInput] = useState(range.to);
  const [, startNav] = useTransition();

  function applyRange(nextFrom: string, nextTo: string) {
    setFromInput(nextFrom);
    setToInput(nextTo);
    const params = new URLSearchParams();
    params.set("from", nextFrom);
    params.set("to", nextTo);
    startNav(() => {
      router.push(`/marketing/voxbay?${params.toString()}`);
    });
  }

  const presets = useMemo(() => {
    const today = todayIst();
    const monthFirst = today.slice(0, 8) + "01";
    const todayMinus = (n: number) => addDaysIst(today, -n);
    const lastMonthFirst = lastMonthFirstIst(today);
    const lastMonthLast = addDaysIst(monthFirst, -1);
    return [
      { label: "MTD", from: monthFirst, to: today },
      { label: "Last 7d", from: todayMinus(6), to: today },
      { label: "Last 30d", from: todayMinus(29), to: today },
      { label: "Last month", from: lastMonthFirst, to: lastMonthLast },
    ];
  }, []);

  const isPreset = useMemo(
    () => presets.find((p) => p.from === range.from && p.to === range.to)?.label ?? null,
    [presets, range],
  );

  const summary = useMemo(() => {
    const total = calls.length;
    const answered = calls.filter((c) => (c.userStatus ?? "").toUpperCase() === "ANSWERED").length;
    const failed = calls.filter((c) => {
      const u = (c.userStatus ?? "").toUpperCase();
      return u === "FAILED" || u === "NOANSWER" || u === "TIMEOUT" || u === "BUSY";
    }).length;
    const sum = calls.reduce((a, c) => a + c.totalDurationSec, 0);
    const avg = total > 0 ? sum / total : 0;
    const ansSum = calls.reduce((a, c) => a + c.answeredDurationSec, 0);
    const ansAvg = answered > 0 ? ansSum / answered : 0;
    return { total, answered, failed, avg, ansAvg };
  }, [calls]);

  // Per-day volume + per-status breakdown
  const dailyVolume = useMemo(() => {
    const byDay = new Map<string, { date: string; total: number; answered: number; failed: number }>();
    for (const c of calls) {
      if (!c.callStartTime) continue;
      const d = c.callStartTime.slice(0, 10);
      const cur = byDay.get(d) ?? { date: d, total: 0, answered: 0, failed: 0 };
      cur.total += 1;
      const u = (c.userStatus ?? "").toUpperCase();
      if (u === "ANSWERED") cur.answered += 1;
      else if (u === "FAILED" || u === "NOANSWER" || u === "TIMEOUT" || u === "BUSY") cur.failed += 1;
      byDay.set(d, cur);
    }
    return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [calls]);

  const statusBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of calls) {
      const k = (c.userStatus ?? "UNKNOWN").toUpperCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [calls]);

  const agentPerformance = useMemo(() => {
    const m = new Map<
      string,
      { name: string; total: number; answered: number; failed: number; talkSec: number }
    >();
    for (const c of calls) {
      // Use lastTriedName when agentName is empty (most rows).
      const a = (c.agentName ?? c.lastTriedName ?? "").trim();
      if (!a) continue;
      const cur = m.get(a) ?? { name: a, total: 0, answered: 0, failed: 0, talkSec: 0 };
      cur.total += 1;
      const u = (c.userStatus ?? "").toUpperCase();
      if (u === "ANSWERED") {
        cur.answered += 1;
        cur.talkSec += c.answeredDurationSec;
      } else if (u === "FAILED" || u === "NOANSWER" || u === "TIMEOUT" || u === "BUSY") {
        cur.failed += 1;
      }
      m.set(a, cur);
    }
    return Array.from(m.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [calls]);

  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const c of calls) {
      const a = (c.agentName ?? c.lastTriedName ?? "").trim();
      if (a) set.add(a);
    }
    return Array.from(set).sort();
  }, [calls]);

  const filteredCalls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      if (statusFilter !== "all" && (c.userStatus ?? "").toUpperCase() !== statusFilter) return false;
      if (agentFilter !== "all" && (c.agentName ?? c.lastTriedName ?? "").trim() !== agentFilter)
        return false;
      if (q) {
        const hay =
          (c.contactName ?? "") +
          " " +
          (c.sourceNumber ?? "") +
          " " +
          (c.didNumber ?? "") +
          " " +
          (c.agentName ?? "") +
          " " +
          (c.lastTriedName ?? "") +
          " " +
          (c.disposition ?? "");
        if (!hay.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [calls, search, statusFilter, agentFilter]);

  async function onUpload(file: File) {
    setError(null);
    setToast(null);
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await fetch("/api/marketing/voxbay/upload", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          (data as { error?: string }).error === "missing_column"
            ? `CSV is missing the "${(data as { column?: string }).column}" column.`
            : (data as { error?: string }).error ?? "Upload failed.",
        );
        return;
      }
      const data = (await res.json()) as { rowCount: number };
      setToast(`Uploaded ${data.rowCount.toLocaleString("en-IN")} calls. Previous data overwritten.`);
      router.refresh();
    });
  }

  const PIE_COLORS = [GOLD, CYAN, ORANGE, "#9f7aea", "#f87171", "#34d399"];

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">Voxbay Call Analysis</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            Incoming-call analytics from the Voxbay export. Suhaina re-uploads the CSV
            whenever a fresh snapshot is needed — the previous load is replaced in one click.
          </p>
        </div>
        {canUpload && (
          <div className="flex items-center gap-[8px]">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-bold inline-flex items-center gap-[6px]"
              style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)", opacity: busy ? 0.6 : 1 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                upload
              </span>
              {busy ? "Uploading…" : "Upload CSV"}
            </button>
          </div>
        )}
      </header>

      {/* Filter row */}
      <div
        className="rounded-[10px] border p-[12px] flex flex-wrap items-center gap-[10px] text-[12px]"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
          color: "var(--lp-on-surface-variant)",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--lp-primary)" }}>
          filter_alt
        </span>
        <span className="text-[11px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
          Range
        </span>
        <input
          type="date"
          value={fromInput}
          onChange={(e) => setFromInput(e.target.value)}
          className="h-[30px] rounded-[6px] px-[8px] text-[12px]"
          style={{
            backgroundColor: "var(--lp-surface-container-high)",
            color: "var(--lp-on-surface)",
            border: "1px solid var(--lp-outline-variant)",
          }}
        />
        <span style={{ opacity: 0.6 }}>→</span>
        <input
          type="date"
          value={toInput}
          onChange={(e) => setToInput(e.target.value)}
          className="h-[30px] rounded-[6px] px-[8px] text-[12px]"
          style={{
            backgroundColor: "var(--lp-surface-container-high)",
            color: "var(--lp-on-surface)",
            border: "1px solid var(--lp-outline-variant)",
          }}
        />
        <button
          onClick={() => applyRange(fromInput, toInput || fromInput)}
          className="h-[30px] px-[12px] rounded-[6px] text-[12px] font-semibold"
          style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
        >
          Apply
        </button>
        <div className="flex flex-wrap items-center gap-[6px] ml-auto">
          {presets.map((p) => {
            const active = isPreset === p.label;
            return (
              <button
                key={p.label}
                onClick={() => applyRange(p.from, p.to)}
                className="h-[28px] px-[10px] rounded-full text-[11px] font-semibold"
                style={{
                  backgroundColor: active
                    ? "rgba(250, 204, 21, 0.18)"
                    : "var(--lp-surface-container-high)",
                  color: active ? "var(--lp-primary)" : "var(--lp-on-surface)",
                  border: `1px solid ${active ? "var(--lp-primary)" : "var(--lp-outline-variant)"}`,
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div
          className="w-full flex flex-wrap items-baseline gap-[6px] mt-[2px] text-[11px]"
          style={{ color: "var(--lp-on-surface-variant)" }}
        >
          Comparing <span style={{ color: "var(--lp-on-surface)" }}>{formatRange(range)}</span>{" "}
          vs prior{" "}
          <span style={{ color: "var(--lp-on-surface)" }}>{formatRange(priorRange)}</span>
        </div>
      </div>

      {/* Upload status strip */}
      <div
        className="rounded-[10px] border p-[12px] flex flex-wrap items-center gap-[12px] text-[12px]"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
          color: "var(--lp-on-surface-variant)",
        }}
      >
        {latestUpload ? (
          <>
            <span>
              Last upload:{" "}
              <span style={{ color: "var(--lp-on-surface)" }}>
                {new Date(latestUpload.uploadedAt).toLocaleString("en-IN")}
              </span>{" "}
              {latestUpload.uploadedBy && (
                <>
                  by{" "}
                  <span style={{ color: "var(--lp-on-surface)" }}>{latestUpload.uploadedBy}</span>
                </>
              )}
            </span>
            <span>·</span>
            <span>
              <span style={{ color: "var(--lp-on-surface)" }}>{latestUpload.rowCount.toLocaleString("en-IN")}</span> rows
            </span>
            {latestUpload.filename && (
              <>
                <span>·</span>
                <span style={{ color: "var(--lp-on-surface)" }}>{latestUpload.filename}</span>
              </>
            )}
          </>
        ) : (
          <span>No data uploaded yet.</span>
        )}
      </div>

      {error && (
        <div
          className="rounded-[10px] border-2 p-[10px] text-[13px]"
          style={{ borderColor: "var(--lp-error)", color: "var(--lp-on-surface)" }}
        >
          {error}
        </div>
      )}
      {toast && (
        <div
          className="rounded-[10px] border-2 p-[10px] text-[13px] flex items-center gap-[8px]"
          style={{
            backgroundColor: "rgba(51, 228, 255, 0.12)",
            borderColor: "var(--lp-cyan)",
            color: "var(--lp-on-surface)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--lp-cyan)" }}>
            check_circle
          </span>
          {toast}
          <button
            onClick={() => setToast(null)}
            className="ml-auto text-[11px] underline"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {calls.length === 0 ? (
        <div
          className="rounded-[12px] border p-[24px] text-center"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
            color: "var(--lp-on-surface-variant)",
          }}
        >
          {latestUpload
            ? "No calls in the selected range. Try a different window or preset."
            : "Upload a Voxbay incoming-call CSV to see the dashboard."}
        </div>
      ) : (
        <>
          {/* KPI strip — value + delta vs same-length prior window */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-[12px]">
            <Kpi
              label="Total Calls"
              value={summary.total.toLocaleString("en-IN")}
              icon="call"
              tone="gold"
              priorLabel="Prior"
              priorValue={prior.total.toLocaleString("en-IN")}
              trend={pctChange(summary.total, prior.total)}
            />
            <Kpi
              label="Answered"
              value={summary.answered.toLocaleString("en-IN")}
              icon="check_circle"
              tone="cyan"
              priorLabel="Prior"
              priorValue={prior.answered.toLocaleString("en-IN")}
              trend={pctChange(summary.answered, prior.answered)}
            />
            <Kpi
              label="Missed / Failed"
              value={summary.failed.toLocaleString("en-IN")}
              icon="error"
              tone="orange"
              priorLabel="Prior"
              priorValue={prior.failed.toLocaleString("en-IN")}
              trend={pctChange(summary.failed, prior.failed)}
              invertTrend
            />
            <Kpi
              label="Avg Call"
              value={secondsToHms(summary.avg)}
              icon="timer"
              tone="gold"
              priorLabel="Prior"
              priorValue={secondsToHms(prior.avgSec)}
              trend={pctChange(summary.avg, prior.avgSec)}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
            {/* Call volume area chart */}
            <Card title="Call Volume — daily" wide>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={dailyVolume} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="voxTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={GOLD} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={GOLD} stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => d.slice(5)}
                    tick={{ fontSize: 11, fill: TEXT }}
                    axisLine={{ stroke: GRID }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: TEXT }}
                    axisLine={{ stroke: GRID }}
                    tickLine={false}
                    width={36}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#231f14", border: `1px solid ${GRID}`, color: "#ebe2d0" }}
                  />
                  <Area type="monotone" dataKey="total" name="Total" stroke={GOLD} strokeWidth={2} fill="url(#voxTotal)" />
                  <Area type="monotone" dataKey="answered" name="Answered" stroke={CYAN} strokeWidth={1.5} fillOpacity={0} />
                  <Area type="monotone" dataKey="failed" name="Failed" stroke={ORANGE} strokeWidth={1.5} fillOpacity={0} />
                </AreaChart>
              </ResponsiveContainer>
              <div
                className="flex items-center gap-[16px] mt-[6px] text-[11px]"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                <LegendSwatch color={GOLD} label="Total" />
                <LegendSwatch color={CYAN} label="Answered" />
                <LegendSwatch color={ORANGE} label="Failed" />
              </div>
            </Card>

            {/* Status pie */}
            <Card title="Status Distribution">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={statusBreakdown}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {statusBreakdown.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "#231f14", border: `1px solid ${GRID}`, color: "#ebe2d0" }}
                  />
                  <ReLegend
                    wrapperStyle={{ fontSize: 11, color: TEXT }}
                    formatter={(v: string) => <span style={{ color: TEXT }}>{v}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Agent performance */}
          <Card title="Agent Performance (top 12 by call volume)" wide>
            <ResponsiveContainer width="100%" height={Math.max(220, 36 * agentPerformance.length)}>
              <BarChart data={agentPerformance} layout="vertical" margin={{ top: 6, right: 40, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: TEXT }} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12, fill: TEXT }} axisLine={{ stroke: GRID }} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#231f14", border: `1px solid ${GRID}`, color: "#ebe2d0" }}
                />
                <Bar dataKey="answered" fill={CYAN} radius={[0, 3, 3, 0]} name="Answered">
                  <LabelList dataKey="answered" position="right" style={{ fill: CYAN, fontSize: 11 }} />
                </Bar>
                <Bar dataKey="failed" fill={ORANGE} radius={[0, 3, 3, 0]} name="Failed">
                  <LabelList dataKey="failed" position="right" style={{ fill: ORANGE, fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div
              className="flex items-center gap-[16px] mt-[6px] text-[11px]"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              <LegendSwatch color={CYAN} label="Answered" />
              <LegendSwatch color={ORANGE} label="Failed / missed" />
            </div>
          </Card>

          {/* Call log table */}
          <Card title={`Call Log — ${filteredCalls.length.toLocaleString("en-IN")} shown`}>
            <div className="flex flex-wrap items-center gap-[8px] mb-[10px]">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search number / agent / disposition"
                className="h-[32px] rounded-[6px] px-[10px] text-[12px] min-w-[220px] flex-1"
              />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-[32px] rounded-[6px] px-[8px] text-[12px]"
              >
                <option value="all">All statuses</option>
                {statusBreakdown.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="h-[32px] rounded-[6px] px-[8px] text-[12px]"
              >
                <option value="all">All agents</option>
                {agents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto rounded-[8px] border" style={{ borderColor: "var(--lp-outline-variant)" }}>
              <table className="w-full text-[12px] tabular-nums">
                <thead style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                  <tr>
                    <Th>Start</Th>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th>Agent</Th>
                    <Th>Status</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Answered</Th>
                    <Th>Recording</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCalls.slice(0, 500).map((c) => (
                    <tr
                      key={c.id}
                      className="border-t"
                      style={{ borderColor: "var(--lp-outline-variant)" }}
                    >
                      <td className="px-[10px] py-[6px] font-mono whitespace-nowrap">
                        {c.callStartTime ? c.callStartTime.replace("T", " ").slice(0, 19) : "—"}
                      </td>
                      <td className="px-[10px] py-[6px] font-mono">{c.sourceNumber ?? "—"}</td>
                      <td className="px-[10px] py-[6px] font-mono">{c.didNumber ?? "—"}</td>
                      <td className="px-[10px] py-[6px]">
                        {(c.agentName ?? c.lastTriedName ?? "—").trim() || "—"}
                      </td>
                      <td className="px-[10px] py-[6px]">
                        <StatusChip status={c.userStatus} />
                      </td>
                      <td className="px-[10px] py-[6px] text-right font-mono">
                        {c.totalDurationDisplay ?? "—"}
                      </td>
                      <td className="px-[10px] py-[6px] text-right font-mono" style={{ color: "var(--lp-cyan)" }}>
                        {c.answeredDurationDisplay ?? "—"}
                      </td>
                      <td className="px-[10px] py-[6px]">
                        {c.callRecordFile ? (
                          <a
                            href={c.callRecordFile}
                            target="_blank"
                            rel="noreferrer"
                            className="underline text-[11px]"
                            style={{ color: "var(--lp-primary)" }}
                          >
                            ▶ Listen
                          </a>
                        ) : (
                          <span style={{ color: "var(--lp-on-surface-variant)", opacity: 0.6 }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredCalls.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-[10px] py-[14px] text-center"
                        style={{ color: "var(--lp-on-surface-variant)" }}
                      >
                        No calls match the filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredCalls.length > 500 && (
              <p
                className="text-[11px] mt-[6px]"
                style={{ color: "var(--lp-on-surface-variant)" }}
              >
                Showing the first 500 rows — narrow the filters above to see the rest.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone,
  priorLabel,
  priorValue,
  trend,
  invertTrend,
}: {
  label: string;
  value: string;
  icon: string;
  tone: "gold" | "cyan" | "orange";
  priorLabel?: string;
  priorValue?: string;
  trend?: number | null;
  /** When true, downward movement is "good" (used for Missed / Failed). */
  invertTrend?: boolean;
}) {
  const color = tone === "gold" ? "var(--lp-primary)" : tone === "cyan" ? "var(--lp-cyan)" : "var(--lp-orange)";
  const trendIsGood = trend == null ? null : invertTrend ? trend <= 0 : trend >= 0;
  return (
    <div
      className="rounded-[12px] p-[16px] border flex items-start justify-between gap-[8px]"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <div className="min-w-0">
        <span
          className="inline-flex items-center justify-center w-[32px] h-[32px] rounded-[8px] mb-[8px]"
          style={{ backgroundColor: "var(--lp-surface-container-high)", color }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            {icon}
          </span>
        </span>
        <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
          {label}
        </p>
        <p className="text-[26px] font-bold tabular-nums mt-[2px]" style={{ color }}>
          {value}
        </p>
        {priorLabel && priorValue != null && (
          <p
            className="text-[11px] mt-[6px] flex flex-wrap items-baseline gap-[6px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <span style={{ opacity: 0.8 }}>{priorLabel}:</span>
            <span className="tabular-nums" style={{ color: "var(--lp-on-surface)" }}>
              {priorValue}
            </span>
          </p>
        )}
      </div>
      {trend != null && (
        <span
          className="text-[11px] px-[8px] py-[2px] rounded-full whitespace-nowrap"
          style={{
            backgroundColor:
              trendIsGood ? "rgba(51, 228, 255, 0.18)" : "rgba(255, 180, 171, 0.18)",
            color: trendIsGood ? "var(--lp-cyan)" : "var(--lp-error)",
          }}
          title="vs prior window"
        >
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

function pctChange(now: number, prev: number): number | null {
  if (prev === 0) return now === 0 ? 0 : null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

function formatRange(r: Range): string {
  return `${formatShort(r.from)} – ${formatShort(r.to)}`;
}

function formatShort(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function todayIst(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function addDaysIst(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function lastMonthFirstIst(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const ly = m === 1 ? y - 1 : y;
  const lm = m === 1 ? 12 : m - 1;
  return `${ly}-${String(lm).padStart(2, "0")}-01`;
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={"rounded-[12px] border p-[16px] " + (wide ? "lg:col-span-2" : "")}
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <h2 className="text-[14px] font-semibold mb-[8px]" style={{ color: "var(--lp-on-surface)" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="px-[10px] py-[8px] text-[10px] uppercase tracking-widest font-semibold whitespace-nowrap"
      style={{ color: "var(--lp-on-surface-variant)", textAlign: align ?? "left" }}
    >
      {children}
    </th>
  );
}

function StatusChip({ status }: { status: string | null }) {
  const s = (status ?? "").toUpperCase() || "—";
  const map: Record<string, { bg: string; color: string }> = {
    ANSWERED: { bg: "rgba(51, 228, 255, 0.18)", color: "var(--lp-cyan)" },
    FAILED: { bg: "rgba(255, 180, 171, 0.18)", color: "var(--lp-error)" },
    NOANSWER: { bg: "rgba(255, 180, 147, 0.18)", color: "var(--lp-orange)" },
    BUSY: { bg: "rgba(255, 180, 147, 0.18)", color: "var(--lp-orange)" },
    TIMEOUT: { bg: "rgba(255, 180, 147, 0.18)", color: "var(--lp-orange)" },
  };
  const tone = map[s] ?? { bg: "rgba(154, 144, 120, 0.18)", color: "var(--lp-on-surface-variant)" };
  return (
    <span
      className="text-[10px] px-[8px] py-[2px] rounded-full font-semibold uppercase tracking-widest"
      style={{ backgroundColor: tone.bg, color: tone.color }}
    >
      {s}
    </span>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-[4px]">
      <span style={{ width: 10, height: 10, backgroundColor: color, borderRadius: 2 }} />
      {label}
    </span>
  );
}

function secondsToHms(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "00:00:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
