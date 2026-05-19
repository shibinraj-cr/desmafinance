"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
}: {
  canUpload: boolean;
  latestUpload: {
    filename: string | null;
    rowCount: number;
    uploadedAt: string;
    uploadedBy: string | null;
  } | null;
  calls: Call[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");

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
          Upload a Voxbay incoming-call CSV to see the dashboard.
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-[12px]">
            <Kpi label="Total Calls" value={summary.total.toLocaleString("en-IN")} icon="call" tone="gold" />
            <Kpi label="Answered" value={summary.answered.toLocaleString("en-IN")} icon="check_circle" tone="cyan" />
            <Kpi label="Missed / Failed" value={summary.failed.toLocaleString("en-IN")} icon="error" tone="orange" />
            <Kpi label="Avg Call" value={secondsToHms(summary.avg)} icon="timer" tone="gold" />
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
}: {
  label: string;
  value: string;
  icon: string;
  tone: "gold" | "cyan" | "orange";
}) {
  const color = tone === "gold" ? "var(--lp-primary)" : tone === "cyan" ? "var(--lp-cyan)" : "var(--lp-orange)";
  return (
    <div
      className="rounded-[12px] p-[16px] border"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
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
    </div>
  );
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
