import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import {
  getLeadPulseAccess,
  leadPulseRoleLabel,
  leadPulseRoleBadgeClass,
  type LeadPulseRoleSlug,
} from "@/lib/lead-pulse-rbac";
import {
  getFunnelTotals,
  getFunnelBySource,
  monthBounds,
} from "@/lib/lead-pulse-metrics";
import { addDays, todayIst, fromPrismaDate, toPrismaDate } from "@/lib/lead-pulse-dates";
import { PerformanceOverTimeChart } from "../../_charts";
import { BdeInsightCard } from "./_bde-insight-card";

export const dynamic = "force-dynamic";

const RANGE_OPTIONS = ["30d", "90d", "ytd", "all", "month"] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number];

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default async function BdePerformanceDetail({
  params,
  searchParams,
}: {
  params: { userId: string };
  searchParams: { range?: string; year?: string; month?: string };
}) {
  const { userId: actorId, perms } = await getCurrentUserAndPermissions();
  if (!actorId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(actorId, perms);

  // BDEs can only view their own page; supervisors see anyone.
  if (!access.canSupervise && actorId !== params.userId) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
        >
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            You can only view your own performance page.
          </p>
        </div>
      </div>
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: params.userId },
    include: { leadPulseRole: true },
  });
  if (!target || !target.leadPulseRole) notFound();

  const role = target.leadPulseRole.role as LeadPulseRoleSlug;
  if (role !== "l1" && role !== "l2") notFound();

  const range: RangeKey =
    searchParams.range === "30d"
      ? "30d"
      : searchParams.range === "90d"
        ? "90d"
        : searchParams.range === "ytd"
          ? "ytd"
          : searchParams.range === "all"
            ? "all"
            : searchParams.range === "month"
              ? "month"
              : "90d";

  const today = todayIst();
  const yearNow = Number(today.slice(0, 4));
  const monthNow = Number(today.slice(5, 7));
  const pickYear = searchParams.year ? Math.max(2024, Math.min(2100, Number(searchParams.year))) : yearNow;
  const pickMonth = searchParams.month ? Math.max(1, Math.min(12, Number(searchParams.month))) : monthNow;

  let start: string;
  let end: string = today;
  if (range === "30d") start = addDays(today, -29);
  else if (range === "90d") start = addDays(today, -89);
  else if (range === "ytd") start = `${today.slice(0, 4)}-01-01`;
  else if (range === "month") {
    const mb = monthBounds(pickYear, pickMonth);
    start = mb.start;
    // Cap end at today if viewing the current month so we don't pull
    // future-dated rows into a series.
    end = mb.end > today ? today : mb.end;
  } else start = "2000-01-01";

  const userId = params.userId;

  const [totals, sourceRows, teamTotals, dailyEntries, recent, insightRow] = await Promise.all([
    getFunnelTotals({ start, end, userId }),
    getFunnelBySource({ start, end }),
    getFunnelTotals({ start, end }),
    prisma.leadPulseDailyEntry.findMany({
      where: { userId, entryDate: { gte: toPrismaDate(start), lte: toPrismaDate(end) }, status: "submitted" },
      select: { entryDate: true, leadsReceived: true, transferredToL2: true, receivedFromL1: true, directLeads: true, closedWon: true, roleAtEntry: true },
    }),
    prisma.leadPulseDailyEntry.findMany({
      where: { userId, status: { in: ["submitted", "draft"] } },
      orderBy: [{ entryDate: "desc" }],
      take: 60,
      include: { source: { select: { label: true } } },
    }),
    // Insight is always scoped to a calendar month — use the month
    // picker when active, otherwise default to the current calendar
    // month even if the user is looking at 90d/YTD/all on the funnel.
    prisma.leadPulseBdeInsight.findUnique({
      where: {
        userId_year_month: {
          userId,
          year: range === "month" ? pickYear : yearNow,
          month: range === "month" ? pickMonth : monthNow,
        },
      },
    }),
  ]);

  const totalLeads = totals.l1Leads + totals.l2Leads;
  const totalWon = role === "l1" ? totals.l1Won : totals.l2Won;
  const totalConv = role === "l1" ? totals.l1ConversionPct : totals.l2ConversionPct;
  const teamTotalLeads = teamTotals.l1Leads + teamTotals.l2Leads;
  const teamConv = teamTotalLeads === 0 ? null : ((teamTotals.l1Won + teamTotals.l2Won) / teamTotalLeads) * 100;
  const personalConv = totalLeads === 0 ? null : ((totals.l1Won + totals.l2Won) / totalLeads) * 100;
  const vsTeam = personalConv != null && teamConv != null ? personalConv - teamConv : null;
  const distinctDays = new Set(dailyEntries.map((e) => e.entryDate.toISOString().slice(0, 10))).size;

  // Build a per-day series for the time-series chart. Bucket weekly when
  // the range is > 30 days for readability.
  const useWeekly = range !== "30d" && range !== "all";
  const series = buildSeries(dailyEntries, role, start, end, useWeekly);

  // Per-source rows reduced to the BDE's own data.
  const ownPerSource = await Promise.all(
    sourceRows.map(async (s) => {
      const own = await getFunnelTotals({
        start,
        end,
        userId,
        sourceId: s.sourceId,
      });
      const ownLeads = own.l1Leads + own.l2Leads;
      const ownWon = role === "l1" ? own.l1Won : own.l2Won;
      const teamLeads = s.l1Leads + s.l2Leads;
      const teamWon = role === "l1" ? s.l1Won : s.l2Won;
      const ownPct = ownLeads ? (ownWon / ownLeads) * 100 : null;
      const teamPct = teamLeads ? (teamWon / teamLeads) * 100 : null;
      return {
        sourceLabel: s.sourceLabel,
        leads: ownLeads,
        won: ownWon,
        conversionPct: ownPct,
        vsTeam: ownPct != null && teamPct != null ? ownPct - teamPct : null,
      };
    }),
  );

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <Link
            href="/marketing/lead-pulse/bde-performance"
            className="text-[12px] inline-flex items-center gap-[4px]"
            style={{ color: "var(--lp-on-surface-variant)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_back</span>
            Back to BDEs
          </Link>
          <h1 className="text-[28px] font-bold tracking-tight mt-[4px]">{target.leadPulseRole.displayName}</h1>
          <div className="mt-[4px] flex items-center gap-[8px] text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            <span className={`px-[8px] py-[2px] rounded-full font-semibold ${leadPulseRoleBadgeClass(role)}`}>
              {leadPulseRoleLabel(role)}
            </span>
            {target.leadPulseRole.regionFocus.length > 0 && (
              <span>· {target.leadPulseRole.regionFocus.join(", ")}</span>
            )}
            <span>· @{target.username}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <DownloadSnapshotLink
            userId={userId}
            range={range}
            pickYear={pickYear}
            pickMonth={pickMonth}
            displayName={target.leadPulseRole.displayName}
          />
          <RangeTabs current={range} userId={userId} pickYear={pickYear} pickMonth={pickMonth} />
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[16px]">
        <Kpi label="Total Leads" value={totalLeads.toString()} />
        <Kpi
          label={role === "l1" ? "L1 Conversion" : "L2 Conversion"}
          value={totalConv == null ? "—" : `${totalConv.toFixed(1)}%`}
        />
        <Kpi label="Days Active" value={distinctDays.toString()} />
        <Kpi
          label="vs Team Avg"
          value={vsTeam == null ? "—" : `${vsTeam >= 0 ? "+" : ""}${vsTeam.toFixed(1)} pp`}
          tone={vsTeam == null ? "neutral" : vsTeam >= 0 ? "positive" : "negative"}
        />
      </div>

      <BdeInsightCard
        initial={
          insightRow
            ? {
                id: insightRow.id,
                userId: insightRow.userId,
                year: insightRow.year,
                month: insightRow.month,
                analysis: insightRow.analysis,
                questions: insightRow.questions as unknown as Array<{ id: string; question: string; hint?: string }>,
                answers: (insightRow.answers as unknown as Record<string, string> | null) ?? null,
                feedback: insightRow.feedback,
                status: insightRow.status as "draft" | "answered",
                answeredAt: insightRow.answeredAt?.toISOString() ?? null,
                createdAt: insightRow.createdAt.toISOString(),
                updatedAt: insightRow.updatedAt.toISOString(),
              }
            : null
        }
        bdeUserId={userId}
        bdeDisplayName={target.leadPulseRole.displayName}
        isSelf={actorId === userId}
        canSupervise={access.canSupervise}
        year={range === "month" ? pickYear : yearNow}
        month={range === "month" ? pickMonth : monthNow}
      />

      <Card title="Performance Over Time">
        <PerformanceOverTimeChart data={series} role={role} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
        <Card title="Performance by Source">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                <Th>Source</Th>
                <Th align="right">Leads</Th>
                <Th align="right">Won</Th>
                <Th align="right">Conv %</Th>
                <Th align="right">vs Team</Th>
              </tr>
            </thead>
            <tbody>
              {ownPerSource.map((s) => (
                <tr key={s.sourceLabel} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                  <td className="px-[16px] py-[8px]">{s.sourceLabel}</td>
                  <td className="px-[16px] py-[8px] text-right tabular-nums">{s.leads}</td>
                  <td className="px-[16px] py-[8px] text-right tabular-nums">{s.won}</td>
                  <td className="px-[16px] py-[8px] text-right tabular-nums">
                    {s.conversionPct == null ? "—" : `${s.conversionPct.toFixed(1)}%`}
                  </td>
                  <td className="px-[16px] py-[8px] text-right">
                    {s.vsTeam == null ? (
                      <span style={{ color: "var(--lp-on-surface-variant)" }}>—</span>
                    ) : (
                      <span
                        className="text-[11px] px-[8px] py-[2px] rounded-full"
                        style={{
                          backgroundColor: s.vsTeam >= 0 ? "rgba(51, 228, 255, 0.18)" : "rgba(255, 180, 171, 0.18)",
                          color: s.vsTeam >= 0 ? "var(--lp-cyan)" : "var(--lp-error)",
                        }}
                      >
                        {s.vsTeam >= 0 ? "+" : ""}
                        {s.vsTeam.toFixed(1)}pp
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Recent Daily Entries">
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                <Th>Date</Th>
                <Th>Source</Th>
                <Th align="right">Leads</Th>
                <Th align="right">{role === "l1" ? "→ L2" : "Won"}</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {recent.slice(0, 30).map((e) => {
                const leads = role === "l1" ? e.leadsReceived ?? 0 : (e.receivedFromL1 ?? 0) + (e.directLeads ?? 0);
                const won = role === "l1" ? e.transferredToL2 ?? 0 : e.closedWon ?? 0;
                return (
                  <tr key={e.id} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                    <td className="px-[16px] py-[8px] tabular-nums">{fromPrismaDate(e.entryDate)}</td>
                    <td className="px-[16px] py-[8px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                      {e.source.label}
                    </td>
                    <td className="px-[16px] py-[8px] text-right tabular-nums">{leads}</td>
                    <td className="px-[16px] py-[8px] text-right tabular-nums">{won}</td>
                    <td className="px-[16px] py-[8px]">
                      <StatusPill status={e.status} locked={e.locked} />
                    </td>
                  </tr>
                );
              })}
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-[16px] py-[16px] text-center" style={{ color: "var(--lp-on-surface-variant)" }}>
                    No entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function buildSeries(
  entries: { entryDate: Date; leadsReceived: number | null; transferredToL2: number | null; receivedFromL1: number | null; directLeads: number | null; closedWon: number | null; roleAtEntry: string }[],
  role: "l1" | "l2",
  start: string,
  end: string,
  weekly: boolean,
): { label: string; leads: number; won: number; conversionPct: number | null }[] {
  type Bucket = { leads: number; won: number };
  const map = new Map<string, Bucket>();
  for (const e of entries) {
    const dStr = e.entryDate.toISOString().slice(0, 10);
    const key = weekly ? weekKey(dStr) : dStr;
    const cur = map.get(key) ?? { leads: 0, won: 0 };
    if (role === "l1") {
      cur.leads += e.leadsReceived ?? 0;
      cur.won += e.transferredToL2 ?? 0;
    } else {
      cur.leads += (e.receivedFromL1 ?? 0) + (e.directLeads ?? 0);
      cur.won += e.closedWon ?? 0;
    }
    map.set(key, cur);
  }
  const keys = Array.from(map.keys()).sort();
  return keys.map((k) => {
    const b = map.get(k)!;
    return {
      label: weekly ? `Wk ${k.slice(5)}` : k.slice(5),
      leads: b.leads,
      won: b.won,
      conversionPct: b.leads ? Math.round((b.won / b.leads) * 1000) / 10 : null,
    };
  });
}

function weekKey(dateStr: string): string {
  // ISO-ish week bucket: YYYY-Www. Cheap floor-to-monday approximation.
  const dt = new Date(`${dateStr}T00:00:00Z`);
  const dow = dt.getUTCDay() || 7;
  if (dow > 1) dt.setUTCDate(dt.getUTCDate() - (dow - 1));
  return dt.toISOString().slice(0, 10);
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const color =
    tone === "positive" ? "var(--lp-cyan)" : tone === "negative" ? "var(--lp-error)" : "var(--lp-primary)";
  return (
    <div
      className="rounded-[12px] p-[16px] border"
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <p
        className="text-[10px] uppercase tracking-widest"
        style={{ color: "var(--lp-on-surface-variant)" }}
      >
        {label}
      </p>
      <p className="text-[24px] font-bold tabular-nums mt-[4px]" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[12px] border p-[20px]"
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <h2 className="text-[14px] font-semibold mb-[12px]">{title}</h2>
      {children}
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="px-[16px] py-[8px] text-[11px] font-semibold uppercase tracking-[0.05em]"
      style={{ textAlign: align ?? "left", color: "var(--lp-on-surface-variant)" }}
    >
      {children}
    </th>
  );
}

function StatusPill({ status, locked }: { status: string; locked: boolean }) {
  if (locked) {
    return (
      <span className="text-[11px] px-[8px] py-[2px] rounded-full font-semibold" style={{ backgroundColor: "rgba(154,144,120,0.18)", color: "var(--lp-on-surface-variant)" }}>
        Locked
      </span>
    );
  }
  if (status === "submitted") {
    return (
      <span className="text-[11px] px-[8px] py-[2px] rounded-full font-semibold" style={{ backgroundColor: "rgba(51, 228, 255, 0.18)", color: "var(--lp-cyan)" }}>
        Submitted
      </span>
    );
  }
  return (
    <span className="text-[11px] px-[8px] py-[2px] rounded-full font-semibold" style={{ backgroundColor: "rgba(255, 182, 147, 0.18)", color: "var(--lp-orange)" }}>
      Draft
    </span>
  );
}

/**
 * Anchor styled as a button that links to the OG-image PNG route.
 * Browser downloads via the route's Content-Disposition header — no
 * client-side canvas / html2canvas dep. The link carries the same
 * range params the page is on so the snapshot matches what Suhaina is
 * looking at.
 */
function DownloadSnapshotLink({
  userId,
  range,
  pickYear,
  pickMonth,
  displayName,
}: {
  userId: string;
  range: RangeKey;
  pickYear: number;
  pickMonth: number;
  displayName: string;
}) {
  const params = new URLSearchParams();
  params.set("range", range);
  if (range === "month") {
    params.set("year", String(pickYear));
    params.set("month", String(pickMonth));
  }
  return (
    <a
      href={`/api/marketing/lead-pulse/bde-performance/${userId}/og?${params.toString()}`}
      className="inline-flex items-center gap-[6px] h-[32px] px-[12px] rounded-[8px] text-[12px] font-semibold border"
      style={{
        borderColor: "var(--lp-primary)",
        backgroundColor: "rgba(250, 204, 21, 0.10)",
        color: "var(--lp-primary)",
      }}
      title={`Download ${displayName}'s snapshot as PNG (mobile-friendly, share on WhatsApp)`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>
        download
      </span>
      Download PNG
    </a>
  );
}

function RangeTabs({
  current,
  userId,
  pickYear,
  pickMonth,
}: {
  current: RangeKey;
  userId: string;
  pickYear: number;
  pickMonth: number;
}) {
  const labels: Record<RangeKey, string> = {
    "30d": "30 days",
    "90d": "90 days",
    ytd: "YTD",
    all: "All time",
    month: "Month",
  };
  // 12 most recent months as picker options.
  const monthOpts: Array<{ y: number; m: number }> = [];
  let y = pickYear;
  let m = pickMonth;
  for (let i = 0; i < 12; i++) {
    monthOpts.push({ y, m });
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return (
    <div className="flex flex-wrap items-center gap-[4px]">
      {RANGE_OPTIONS.map((r) => (
        <Link
          key={r}
          href={
            r === "month"
              ? `/marketing/lead-pulse/bde-performance/${userId}?range=month&year=${pickYear}&month=${pickMonth}`
              : `/marketing/lead-pulse/bde-performance/${userId}?range=${r}`
          }
          className="h-[32px] px-[12px] rounded-[8px] inline-flex items-center text-[12px] font-semibold border"
          style={{
            borderColor: current === r ? "var(--lp-primary)" : "var(--lp-outline-variant)",
            color: current === r ? "var(--lp-primary)" : "var(--lp-on-surface-variant)",
            backgroundColor: current === r ? "rgba(250, 204, 21, 0.08)" : "transparent",
          }}
        >
          {labels[r]}
        </Link>
      ))}
      {current === "month" && (
        <form action={`/marketing/lead-pulse/bde-performance/${userId}`} className="flex items-center gap-[4px]">
          <input type="hidden" name="range" value="month" />
          <select
            name="year"
            defaultValue={String(pickYear)}
            className="h-[32px] px-[6px] rounded-[6px] text-[12px]"
          >
            {Array.from(new Set(monthOpts.map((o) => o.y))).map((yy) => (
              <option key={yy} value={yy}>{yy}</option>
            ))}
          </select>
          <select
            name="month"
            defaultValue={String(pickMonth)}
            className="h-[32px] px-[6px] rounded-[6px] text-[12px]"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
              <option key={mm} value={mm}>{MONTH_LABELS[mm - 1]}</option>
            ))}
          </select>
          <button
            type="submit"
            className="h-[32px] px-[10px] rounded-[6px] text-[12px] font-semibold"
            style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
          >
            Apply
          </button>
        </form>
      )}
    </div>
  );
}
