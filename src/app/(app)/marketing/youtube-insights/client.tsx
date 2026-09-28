"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  LEAD_METRIC_LABELS,
  VIEW_METRIC_LABELS,
  lagScan,
  leadValue,
  strengthPhrase,
  uploadLift,
  weekly,
  weeklyCorrelation,
  type Correlation,
  type InsightsDay,
  type InsightsVideo,
  type LeadMetric,
  type ViewMetric,
} from "@/lib/youtube/insights-shared";

// Validated (dataviz validate_palette, dark, surface #231f14): lightness band,
// chroma floor, CVD + normal-vision separation, contrast — all PASS. The
// brighter --lp-* accents fail the band on this surface, so charts use these.
const SHORTS = "#b88c00";
const LONG = "#1597b3";
const LEADS = "#e06a36";
const TEXT = "#d1c6ab";
const GRID = "#4d4632";
const MUTED = "var(--lp-on-surface-variant)";

type Connection = {
  channelTitle: string;
  channelId: string;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
} | null;

const FLASH: Record<string, { tone: "ok" | "err"; text: string }> = {
  connected: { tone: "ok", text: "Channel connected and the first sync finished." },
  connected_sync_failed: { tone: "err", text: "Channel connected, but the first sync failed — see the status below and press Sync now." },
  denied: { tone: "err", text: "Google consent was cancelled — nothing was connected." },
  bad_state: { tone: "err", text: "The sign-in link expired or was tampered with. Start Connect again." },
  no_refresh_token: { tone: "err", text: "Google didn't return a long-lived token. Remove DesGro under myaccount.google.com → Security → Third-party access, then connect again." },
  exchange_failed: { tone: "err", text: "Google rejected the sign-in. Check the redirect URI and client secret in Google Cloud." },
  no_channel: { tone: "err", text: "That Google account has no YouTube channel. Pick the channel's account (or brand account) on the consent screen." },
  not_configured: { tone: "err", text: "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not set on the server yet." },
};

const fmt = (n: number) => n.toLocaleString("en-IN");
const shortDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[12px] border p-[14px] ${className}`}
      style={{ borderColor: "var(--lp-outline-variant)", backgroundColor: "var(--lp-surface-container-low)" }}
    >
      {children}
    </section>
  );
}

function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-[10px]">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {sub && (
        <p className="mt-[2px] text-[12px]" style={{ color: MUTED }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-full px-[12px] py-[5px] text-[12px] font-semibold border"
      style={{
        borderColor: active ? "var(--lp-primary)" : "var(--lp-outline-variant)",
        backgroundColor: active ? "var(--lp-primary)" : "transparent",
        color: active ? "var(--lp-on-primary)" : "var(--lp-on-surface)",
      }}
    >
      {children}
    </button>
  );
}

function StrengthBadge({ c }: { c: Correlation }) {
  const label =
    c.strength === "insufficient" ? "Too little data" : c.strength === "none" ? "No link" : `${c.strength} ${(c.r ?? 0) >= 0 ? "+" : "−"}`;
  return (
    <span
      className="rounded-full border px-[8px] py-[2px] text-[10px] font-bold uppercase tracking-widest"
      style={{ borderColor: "var(--lp-outline)", color: "var(--lp-on-surface)" }}
    >
      {label}
    </span>
  );
}

const tooltipStyle = {
  contentStyle: { backgroundColor: "#2e2a1e", border: `1px solid ${GRID}`, borderRadius: 8, fontSize: 12 },
  labelStyle: { color: TEXT },
  itemStyle: { color: "#ebe2d0" },
};

export function YouTubeInsightsClient(props: {
  rangeDays: number;
  ranges: number[];
  from: string;
  to: string;
  days: InsightsDay[];
  videos: InsightsVideo[];
  connection: Connection;
  oauthConfigured: boolean;
  redirectUri: string;
  flash: string | null;
}) {
  const { days, videos, connection } = props;
  const router = useRouter();
  const [metric, setMetric] = useState<LeadMetric>("both");
  const [viewMetric, setViewMetric] = useState<ViewMetric>("views");
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(
    props.flash ? (FLASH[props.flash] ?? null) : null,
  );
  const [liftSort, setLiftSort] = useState<"lift" | "date">("lift");

  const hasViews = days.some((d) => d.views !== null);
  const hasSplit = days.some((d) => (d.shortsViews ?? 0) + (d.videoViews ?? 0) > 0);
  const hasCallers = days.some((d) => d.voxbayCallers !== null);

  const totals = useMemo(() => {
    let views = 0;
    let shorts = 0;
    let longs = 0;
    let yt = 0;
    let vox = 0;
    for (const d of days) {
      views += d.views ?? 0;
      shorts += d.shortsPublished;
      longs += d.videosPublished;
      yt += d.ytLeads;
      vox += d.voxbayLeads;
    }
    return { views, shorts, longs, yt, vox };
  }, [days]);

  const viewOf = useMemo(() => (d: InsightsDay) => d[viewMetric], [viewMetric]);
  const lag = useMemo(() => lagScan(days, viewOf, (d) => leadValue(d, metric)), [days, viewOf, metric]);
  const weeks = useMemo(() => weekly(days, metric), [days, metric]);
  const weeklyViews = useMemo(() => weeklyCorrelation(weeks, (w) => w[viewMetric]), [weeks, viewMetric]);
  const weeklyShorts = useMemo(() => weeklyCorrelation(weeks, (w) => w.shortsPublished), [weeks]);
  const weeklyLongs = useMemo(() => weeklyCorrelation(weeks, (w) => w.videosPublished), [weeks]);
  const lifts = useMemo(() => {
    const l = uploadLift(days, videos, metric);
    return liftSort === "lift"
      ? [...l].sort((a, b) => b.lift - a.lift)
      : [...l].sort((a, b) => b.video.publishDay.localeCompare(a.video.publishDay));
  }, [days, videos, metric, liftSort]);

  const chartDays = useMemo(
    () =>
      days.map((d) => ({
        day: d.day,
        label: shortDay(d.day),
        shortsViews: d.shortsViews,
        videoViews: d.videoViews,
        views: d.views,
        leads: leadValue(d, metric),
        shortsPublished: d.shortsPublished,
        videosPublished: d.videosPublished,
      })),
    [days, metric],
  );

  async function post(path: string, body?: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; result?: { videos: number; days: number; warning: string | null } };
    return { ok: res.ok, json };
  }

  function syncNow(full = false) {
    startTransition(async () => {
      setMessage({ tone: "ok", text: full ? "Re-pulling full history… this can take a minute." : "Syncing…" });
      const { ok, json } = await post("/api/marketing/youtube/sync", { full });
      if (ok && json.result) {
        setMessage({
          tone: json.result.warning ? "err" : "ok",
          text: `Synced ${json.result.videos} uploads and ${json.result.days} days of analytics.${json.result.warning ? ` ${json.result.warning}` : ""}`,
        });
      } else {
        setMessage({ tone: "err", text: json.error || json.message || "Sync failed." });
      }
      router.refresh();
    });
  }

  function disconnect() {
    if (!confirm("Disconnect the YouTube channel? Synced history is kept; the daily sync stops until you reconnect.")) return;
    startTransition(async () => {
      const { ok, json } = await post("/api/marketing/youtube/disconnect");
      setMessage(ok ? { tone: "ok", text: "Channel disconnected." } : { tone: "err", text: json.error || "Disconnect failed." });
      router.refresh();
    });
  }

  const metricLabel = LEAD_METRIC_LABELS[metric];
  const viewLabel = VIEW_METRIC_LABELS[viewMetric];

  return (
    <div className="px-[16px] sm:px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">YouTube Insights</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: MUTED }}>
            Channel views and uploads against YouTube and Voxbay leads · {shortDay(props.from)} – {shortDay(props.to)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[6px]">
          {props.ranges.map((r) => (
            <Pill key={r} active={r === props.rangeDays} onClick={() => router.push(`?days=${r}`)}>
              {r === 730 ? "2 years" : `${r} days`}
            </Pill>
          ))}
        </div>
      </header>

      {message && (
        <div
          role="status"
          className="rounded-[8px] border px-[12px] py-[8px] text-[13px]"
          style={{
            borderColor: message.tone === "ok" ? "var(--lp-cyan)" : "var(--lp-error)",
            color: message.tone === "ok" ? "var(--lp-on-surface)" : "var(--lp-error)",
          }}
        >
          {message.tone === "ok" ? "✓ " : "⚠ "}
          {message.text}
        </div>
      )}

      {/* ── Connection ───────────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-[12px]">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest" style={{ color: MUTED }}>
              YouTube channel
            </p>
            {connection ? (
              <>
                <p className="mt-[4px] text-[16px] font-semibold truncate">{connection.channelTitle}</p>
                <p className="mt-[2px] text-[12px]" style={{ color: connection.lastSyncOk === false ? "var(--lp-error)" : MUTED }}>
                  {connection.lastSyncAt
                    ? `Last sync ${new Date(connection.lastSyncAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}${connection.lastSyncOk === false ? " — failed" : ""}`
                    : "Not synced yet"}
                  {connection.lastSyncError ? ` · ${connection.lastSyncError}` : ""}
                </p>
              </>
            ) : (
              <p className="mt-[4px] text-[14px]">Not connected — views and uploads will appear once a channel is linked.</p>
            )}
          </div>
          <div className="flex flex-wrap gap-[8px]">
            {connection ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => syncNow(false)}
                  className="rounded-[8px] px-[14px] py-[7px] text-[13px] font-bold disabled:opacity-50"
                  style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
                >
                  {busy ? "Working…" : "Sync now"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => syncNow(true)}
                  className="rounded-[8px] px-[12px] py-[7px] text-[13px] border disabled:opacity-50"
                  style={{ borderColor: "var(--lp-outline-variant)" }}
                >
                  Re-pull history
                </button>
                <a
                  href="/api/marketing/youtube/connect"
                  className="rounded-[8px] px-[12px] py-[7px] text-[13px] border"
                  style={{ borderColor: "var(--lp-outline-variant)" }}
                >
                  Reconnect
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={disconnect}
                  className="rounded-[8px] px-[12px] py-[7px] text-[13px] border disabled:opacity-50"
                  style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-error)" }}
                >
                  Disconnect
                </button>
              </>
            ) : props.oauthConfigured ? (
              <a
                href="/api/marketing/youtube/connect"
                className="rounded-[8px] px-[14px] py-[7px] text-[13px] font-bold"
                style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
              >
                Connect YouTube channel
              </a>
            ) : null}
          </div>
        </div>
        {!props.oauthConfigured && (
          <div className="mt-[12px] rounded-[8px] border p-[12px] text-[12px] space-y-[4px]" style={{ borderColor: "var(--lp-outline-variant)", color: MUTED }}>
            <p className="font-semibold" style={{ color: "var(--lp-on-surface)" }}>
              One-time setup (Google Cloud console)
            </p>
            <p>1. Enable “YouTube Data API v3” and “YouTube Analytics API”.</p>
            <p>2. Create an OAuth client (Web application) with this redirect URI:</p>
            <p className="font-mono break-all" style={{ color: "var(--lp-on-surface)" }}>
              {props.redirectUri}
            </p>
            <p>3. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in Vercel and redeploy.</p>
            <p>4. Publish the OAuth consent screen (“In production”) — in Testing mode Google expires access every 7 days.</p>
          </div>
        )}
      </Card>

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-[12px]">
        {[
          { label: "Channel views", value: hasViews ? fmt(totals.views) : "—" },
          { label: "Shorts published", value: fmt(totals.shorts) },
          { label: "Long videos published", value: fmt(totals.longs) },
          { label: "YouTube leads", value: fmt(totals.yt) },
          { label: "Voxbay leads", value: fmt(totals.vox) },
        ].map((k) => (
          <Card key={k.label}>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: MUTED }}>
              {k.label}
            </p>
            <p className="mt-[6px] text-[26px] font-bold tabular-nums leading-none">{k.value}</p>
          </Card>
        ))}
      </div>

      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="text-[12px]" style={{ color: MUTED }}>
          Leads:
        </span>
        {(Object.keys(LEAD_METRIC_LABELS) as LeadMetric[])
          .filter((m) => m !== "callers" || hasCallers)
          .map((m) => (
            <Pill key={m} active={m === metric} onClick={() => setMetric(m)}>
              {LEAD_METRIC_LABELS[m]}
            </Pill>
          ))}
        <span className="ml-[8px] text-[12px]" style={{ color: MUTED }}>
          Views:
        </span>
        {(Object.keys(VIEW_METRIC_LABELS) as ViewMetric[])
          .filter((m) => m === "views" || hasSplit)
          .map((m) => (
            <Pill key={m} active={m === viewMetric} onClick={() => setViewMetric(m)}>
              {VIEW_METRIC_LABELS[m]}
            </Pill>
          ))}
      </div>

      {/* ── Headline insights ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[12px]">
        <Card>
          <div className="flex items-center justify-between gap-[8px]">
            <p className="text-[13px] font-semibold">Delayed effect</p>
            {lag.best ? <StrengthBadge c={lag.best} /> : <StrengthBadge c={lag.points[0]} />}
          </div>
          <p className="mt-[8px] text-[13px]">
            {lag.best
              ? `${metricLabel} track ${viewLabel.toLowerCase()} most closely ${lag.best.lag === 0 ? "on the same day" : `${lag.best.lag} day${lag.best.lag === 1 ? "" : "s"} later`}.`
              : `No positive day-level link between ${viewLabel.toLowerCase()} and ${metricLabel.toLowerCase()}.`}
          </p>
          <p className="mt-[4px] text-[12px]" style={{ color: MUTED }}>
            {strengthPhrase(lag.best ?? lag.points[0])}
          </p>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-[8px]">
            <p className="text-[13px] font-semibold">Weekly views → leads</p>
            <StrengthBadge c={weeklyViews.change} />
          </div>
          <p className="mt-[8px] text-[13px]">
            When weekly {viewLabel.toLowerCase()} change, do {metricLabel.toLowerCase()} change with them?
          </p>
          <p className="mt-[4px] text-[12px]" style={{ color: MUTED }}>
            Week-over-week: {strengthPhrase(weeklyViews.change)}
          </p>
          <p className="mt-[2px] text-[12px]" style={{ color: MUTED }}>
            Raw weekly totals: {strengthPhrase(weeklyViews.level)}
          </p>
        </Card>
        <Card>
          <div className="flex items-center justify-between gap-[8px]">
            <p className="text-[13px] font-semibold">Posting cadence → leads</p>
            <StrengthBadge c={weeklyShorts.change} />
          </div>
          <p className="mt-[8px] text-[13px]">Weeks with more uploads vs weeks with fewer (week-over-week change).</p>
          <p className="mt-[4px] text-[12px]" style={{ color: MUTED }}>
            Shorts per week: {strengthPhrase(weeklyShorts.change)}
          </p>
          <p className="mt-[2px] text-[12px]" style={{ color: MUTED }}>
            Long videos per week: {strengthPhrase(weeklyLongs.change)}
          </p>
        </Card>
      </div>

      {/* ── Small multiples: views / leads / uploads on one time axis ── */}
      <Card>
        <CardTitle
          title="Views, leads and uploads over time"
          sub="Three charts on the same days — each keeps its own scale instead of sharing a misleading second axis."
        />
        {!hasViews && (
          <p className="mb-[8px] text-[12px]" style={{ color: MUTED }}>
            No channel analytics for this range yet{connection ? " — press Sync now" : " — connect the channel above"}.
          </p>
        )}
        <p className="text-[12px] font-semibold mb-[4px]">Daily views</p>
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartDays} syncId="yt" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: TEXT, fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fill: TEXT, fontSize: 11 }} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
              <Tooltip {...tooltipStyle} formatter={(v) => (typeof v === "number" ? fmt(v) : String(v))} />
              <Legend wrapperStyle={{ fontSize: 12, color: TEXT }} />
              {hasSplit ? (
                <>
                  <Area type="monotone" dataKey="shortsViews" name="Shorts" stackId="v" stroke={SHORTS} fill={SHORTS} fillOpacity={0.35} strokeWidth={2} connectNulls={false} />
                  <Area type="monotone" dataKey="videoViews" name="Long videos" stackId="v" stroke={LONG} fill={LONG} fillOpacity={0.35} strokeWidth={2} connectNulls={false} />
                </>
              ) : (
                <Area type="monotone" dataKey="views" name="Views" stroke={SHORTS} fill={SHORTS} fillOpacity={0.35} strokeWidth={2} connectNulls={false} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[12px] font-semibold mt-[12px] mb-[4px]">Daily {metricLabel.toLowerCase()}</p>
        <div className="h-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartDays} syncId="yt" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: TEXT, fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fill: TEXT, fontSize: 11 }} width={48} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
              <Bar dataKey="leads" name={metricLabel} fill={LEADS} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[12px] font-semibold mt-[12px] mb-[4px]">Uploads per day</p>
        <div className="h-[110px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartDays} syncId="yt" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: TEXT, fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fill: TEXT, fontSize: 11 }} width={48} allowDecimals={false} />
              <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
              <Legend wrapperStyle={{ fontSize: 12, color: TEXT }} />
              <Bar dataKey="shortsPublished" name="Shorts" stackId="u" fill={SHORTS} />
              <Bar dataKey="videosPublished" name="Long videos" stackId="u" fill={LONG} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Lag scan ─────────────────────────────────────────────────── */}
      <Card>
        <CardTitle
          title="How many days after the views do leads follow?"
          sub={`Correlation (r) between ${viewLabel.toLowerCase()} on a day and ${metricLabel.toLowerCase()} 0–7 days later. Taller = closer link; the tallest bar is the likeliest delay.`}
        />
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={lag.points.map((p) => ({ lag: `+${p.lag}d`, r: p.r === null ? 0 : Math.round(p.r * 100) / 100, n: p.n, isBest: lag.best?.lag === p.lag }))}
              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="lag" tick={{ fill: TEXT, fontSize: 11 }} />
              <YAxis tick={{ fill: TEXT, fontSize: 11 }} width={48} domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} />
              <ReferenceLine y={0} stroke={TEXT} />
              <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.05)" }} formatter={(v, _n, item) => [`r = ${v} (n = ${(item as { payload?: { n?: number } }).payload?.n ?? 0})`, "Correlation"]} />
              <Bar dataKey="r" name="Correlation" radius={[4, 4, 0, 0]}>
                {lag.points.map((p) => (
                  <Cell key={p.lag} fill={LEADS} fillOpacity={lag.best?.lag === p.lag ? 1 : 0.45} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── Per-upload lift ──────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-[8px]">
          <CardTitle
            title="Leads after each upload"
            sub={`${metricLabel} on the publish day + next 2 days vs what the previous 14 days would predict. Uploads close together share their effect (flagged).`}
          />
          <div className="flex gap-[6px]">
            <Pill active={liftSort === "lift"} onClick={() => setLiftSort("lift")}>
              Biggest lift
            </Pill>
            <Pill active={liftSort === "date"} onClick={() => setLiftSort("date")}>
              Newest
            </Pill>
          </div>
        </div>
        {lifts.length === 0 ? (
          <p className="text-[13px]" style={{ color: MUTED }}>
            No uploads in this range with 14 days of history before them and 3 days after.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest" style={{ color: MUTED }}>
                  <th className="py-[6px] pr-[8px]">Upload</th>
                  <th className="py-[6px] pr-[8px]">Type</th>
                  <th className="py-[6px] pr-[8px]">Published</th>
                  <th className="py-[6px] pr-[8px] text-right">Views</th>
                  <th className="py-[6px] pr-[8px] text-right">Leads (3d)</th>
                  <th className="py-[6px] pr-[8px] text-right">Expected</th>
                  <th className="py-[6px] text-right">Lift</th>
                </tr>
              </thead>
              <tbody>
                {lifts.slice(0, 40).map((l) => (
                  <tr key={l.video.id} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                    <td className="py-[6px] pr-[8px] max-w-[320px]">
                      <a
                        href={`https://www.youtube.com/watch?v=${l.video.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline line-clamp-1"
                      >
                        {l.video.title}
                      </a>
                      {l.overlapping > 0 && (
                        <span className="text-[10.5px]" style={{ color: MUTED }}>
                          {" "}
                          · {l.overlapping} other upload{l.overlapping === 1 ? "" : "s"} within 2 days
                        </span>
                      )}
                    </td>
                    <td className="py-[6px] pr-[8px] whitespace-nowrap">
                      <span className="inline-block w-[7px] h-[7px] rounded-full mr-[6px]" style={{ backgroundColor: l.video.format === "short" ? SHORTS : LONG }} />
                      {l.video.format === "short" ? "Short" : l.video.format === "live" ? "Live" : "Video"}
                    </td>
                    <td className="py-[6px] pr-[8px] whitespace-nowrap tabular-nums">{shortDay(l.video.publishDay)}</td>
                    <td className="py-[6px] pr-[8px] text-right tabular-nums">{fmt(l.video.viewCount)}</td>
                    <td className="py-[6px] pr-[8px] text-right tabular-nums">{l.actual}</td>
                    <td className="py-[6px] pr-[8px] text-right tabular-nums">{l.expected.toFixed(1)}</td>
                    <td className="py-[6px] text-right tabular-nums font-semibold">
                      {l.lift > 0 ? "▲ +" : l.lift < 0 ? "▼ " : ""}
                      {l.lift.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Daily data table (the accessible / exportable view) ──────── */}
      <Card>
        <details>
          <summary className="cursor-pointer text-[13px] font-semibold">Daily data table</summary>
          <div className="mt-[10px] max-h-[420px] overflow-auto">
            <table className="w-full text-[12px] tabular-nums">
              <thead className="sticky top-0" style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                <tr className="text-left text-[10px] uppercase tracking-widest" style={{ color: MUTED }}>
                  <th className="py-[6px] pr-[8px]">Day</th>
                  <th className="py-[6px] pr-[8px] text-right">Views</th>
                  <th className="py-[6px] pr-[8px] text-right">Shorts views</th>
                  <th className="py-[6px] pr-[8px] text-right">Long views</th>
                  <th className="py-[6px] pr-[8px] text-right">Shorts up</th>
                  <th className="py-[6px] pr-[8px] text-right">Long up</th>
                  <th className="py-[6px] pr-[8px] text-right">YT leads</th>
                  <th className="py-[6px] pr-[8px] text-right">Voxbay leads</th>
                  <th className="py-[6px] text-right">Voxbay callers</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((d) => (
                  <tr key={d.day} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                    <td className="py-[4px] pr-[8px]">{d.day}</td>
                    <td className="py-[4px] pr-[8px] text-right">{d.views === null ? "—" : fmt(d.views)}</td>
                    <td className="py-[4px] pr-[8px] text-right">{d.shortsViews === null ? "—" : fmt(d.shortsViews)}</td>
                    <td className="py-[4px] pr-[8px] text-right">{d.videoViews === null ? "—" : fmt(d.videoViews)}</td>
                    <td className="py-[4px] pr-[8px] text-right">{d.shortsPublished}</td>
                    <td className="py-[4px] pr-[8px] text-right">{d.videosPublished}</td>
                    <td className="py-[4px] pr-[8px] text-right">{d.ytLeads}</td>
                    <td className="py-[4px] pr-[8px] text-right">{d.voxbayLeads}</td>
                    <td className="py-[4px] text-right">{d.voxbayCallers === null ? "—" : d.voxbayCallers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <p className="text-[11.5px] leading-relaxed" style={{ color: MUTED }}>
        How to read this: every number here is a correlation, not proof that a video caused a lead — Meta campaigns,
        seasonality and intakes move leads too. Trust a link more when the week-over-week figure agrees with the raw
        one and the per-upload lift repeats across many uploads. Leads are new CRM leads whose source is YouTube or
        Voxbay (re-enrollments and duplicates excluded), dated by when they entered the CRM (IST). Voxbay callers
        only count days covered by an uploaded Voxbay call report. Shorts are identified as uploads of 3 minutes or
        less; the Shorts/long-video view split comes from YouTube Analytics.
      </p>
    </div>
  );
}
