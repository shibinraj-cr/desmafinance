import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess, leadPulseRoleLabel } from "@/lib/lead-pulse-rbac";
import { prisma } from "@/lib/prisma";
import {
  getFunnelTotals,
  getDailyLeadVolume,
  getConversionBySource,
  getTodaysEntryStatus,
  getPriorityAlerts,
  monthBounds,
} from "@/lib/lead-pulse-metrics";
import { todayIst } from "@/lib/lead-pulse-dates";
import { LeadVolumeChart, ConversionBySourceChart } from "./_charts";

export const dynamic = "force-dynamic";

export default async function LeadPulseHomePage() {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  const access = await getLeadPulseAccess(userId, perms);

  if (access.role === "l1" || access.role === "l2") {
    redirect("/marketing/lead-pulse/daily-entry");
  }
  if (!access.canSupervise) {
    return (
      <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
        <div
          className="rounded-[12px] p-[24px] border"
          style={{
            backgroundColor: "var(--lp-surface-container)",
            borderColor: "var(--lp-outline-variant)",
          }}
        >
          <h1 className="text-[20px] font-semibold mb-[8px]">Lead Pulse access required</h1>
          <p style={{ color: "var(--lp-on-surface-variant)" }}>
            You don&apos;t have a Lead Pulse role assigned yet. Contact your supervisor to get
            added to the team roster.
          </p>
        </div>
      </div>
    );
  }

  const today = todayIst();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const { start: monthStart, end: monthEnd } = monthBounds(year, month);
  // Previous month for trend deltas
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prev = monthBounds(prevYear, prevMonth);

  const [thisMonth, lastMonth, daily, bySource, todays, alerts, activeRoles] = await Promise.all([
    getFunnelTotals({ start: monthStart, end: monthEnd }),
    getFunnelTotals({ start: prev.start, end: prev.end }),
    getDailyLeadVolume(30),
    getConversionBySource({ start: monthStart, end: monthEnd }),
    getTodaysEntryStatus(),
    getPriorityAlerts(),
    prisma.leadPulseRole.count({ where: { active: true, role: { in: ["l1", "l2"] } } }),
  ]);

  const totalLeadsThisMonth = thisMonth.l1Leads + thisMonth.l2Leads;
  const totalLeadsLastMonth = lastMonth.l1Leads + lastMonth.l2Leads;
  const leadsTrend = pctChange(totalLeadsThisMonth, totalLeadsLastMonth);
  const wonTrend = pctChange(thisMonth.l2Won, lastMonth.l2Won);
  const submittedToday = todays.filter((t) => t.status === "submitted").length;

  return (
    <div className="px-[24px] py-[24px] space-y-[16px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight">Lead Pulse Dashboard</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            {access.desfinAdmin && access.role !== "supervisor"
              ? "Admin view — full Lead Pulse access."
              : `Welcome${access.displayName ? `, ${access.displayName}` : ""} · ${leadPulseRoleLabel(access.role)}.`}
          </p>
        </div>
        <QuickActions />
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[16px]">
        <Kpi
          label="Total Leads (this month)"
          value={totalLeadsThisMonth.toString()}
          trend={leadsTrend}
          icon="trending_up"
        />
        <Kpi
          label="L1 → L2 %"
          value={thisMonth.l1ConversionPct == null ? "—" : `${thisMonth.l1ConversionPct.toFixed(1)}%`}
          trend={pctChange(thisMonth.l1ConversionPct ?? 0, lastMonth.l1ConversionPct ?? 0)}
          icon="alt_route"
        />
        <Kpi
          label="Closed-Won"
          value={thisMonth.l2Won.toString()}
          trend={wonTrend}
          icon="emoji_events"
        />
        <Kpi
          label="Active Team"
          value={`${submittedToday}/${activeRoles}`}
          icon="groups"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
        <Card title="Lead Volume (last 30 days)" wide>
          <LeadVolumeChart data={daily} />
        </Card>
        <Card title="Conversion by Source (this month)">
          <ConversionBySourceChart data={bySource} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
        <div className="lg:col-span-2">
          <Card title={`Today's Entries (${today})`}>
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                  <Th>BDE</Th>
                  <Th>Role</Th>
                  <Th align="right">Leads Logged</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {todays.map((t) => (
                  <tr key={t.userId} className="border-t" style={{ borderColor: "var(--lp-outline-variant)" }}>
                    <td className="px-[16px] py-[8px] font-semibold">{t.displayName}</td>
                    <td className="px-[16px] py-[8px] uppercase text-[11px]" style={{ color: roleColor(t.role) }}>
                      {t.role}
                    </td>
                    <td className="px-[16px] py-[8px] text-right tabular-nums">{t.leadsLogged}</td>
                    <td className="px-[16px] py-[8px]">
                      <StatusPill status={t.status} />
                    </td>
                  </tr>
                ))}
                {todays.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-[16px] py-[16px] text-center" style={{ color: "var(--lp-on-surface-variant)" }}>
                      No active BDEs rostered yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>

        <Card title="Priority Alerts">
          {alerts.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
              All clear — no alerts to flag.
            </p>
          ) : (
            <ul className="space-y-[10px]">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-[8px] text-[13px]">
                  <span className="material-symbols-outlined mt-[2px]" style={{ fontSize: 16, color: alertColor(a.kind) }}>
                    {alertIcon(a.kind)}
                  </span>
                  <span className="flex-1" style={{ color: "var(--lp-on-surface)" }}>
                    {a.message}{" "}
                    {a.href && (
                      <Link href={a.href} className="underline" style={{ color: "var(--lp-primary)" }}>
                        View
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function pctChange(now: number, prev: number): number | null {
  if (prev === 0) return now === 0 ? 0 : null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

function Kpi({ label, value, trend, icon }: { label: string; value: string; trend?: number | null; icon: string }) {
  return (
    <div
      className="rounded-[12px] p-[16px] border flex items-start justify-between"
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <div>
        <span
          className="inline-flex items-center justify-center w-[32px] h-[32px] rounded-[8px] mb-[8px]"
          style={{ backgroundColor: "var(--lp-surface-container-high)", color: "var(--lp-primary)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
        </span>
        <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--lp-on-surface-variant)" }}>
          {label}
        </p>
        <p className="text-[26px] font-bold tabular-nums mt-[2px]" style={{ color: "var(--lp-primary)" }}>
          {value}
        </p>
      </div>
      {trend != null && (
        <span
          className="text-[11px] px-[8px] py-[2px] rounded-full"
          style={{
            backgroundColor: trend >= 0 ? "rgba(51, 228, 255, 0.18)" : "rgba(255, 180, 171, 0.18)",
            color: trend >= 0 ? "var(--lp-cyan)" : "var(--lp-error)",
          }}
        >
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={"rounded-[12px] border p-[20px] " + (wide ? "lg:col-span-2" : "")}
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
      className="px-[16px] py-[10px] text-[11px] font-semibold uppercase tracking-[0.05em]"
      style={{ textAlign: align ?? "left", color: "var(--lp-on-surface-variant)" }}
    >
      {children}
    </th>
  );
}

function StatusPill({ status }: { status: "submitted" | "draft" | "missing" }) {
  const map = {
    submitted: { label: "Submitted", bg: "rgba(51, 228, 255, 0.18)", color: "var(--lp-cyan)" },
    draft: { label: "Draft", bg: "rgba(255, 182, 147, 0.18)", color: "var(--lp-orange)" },
    missing: { label: "—", bg: "rgba(154, 144, 120, 0.18)", color: "var(--lp-on-surface-variant)" },
  } as const;
  const { label, bg, color } = map[status];
  return (
    <span
      className="text-[11px] px-[8px] py-[2px] rounded-full font-semibold"
      style={{ backgroundColor: bg, color }}
    >
      {label}
    </span>
  );
}

function roleColor(role: string) {
  if (role === "l1") return "var(--lp-primary)";
  if (role === "l2") return "var(--lp-cyan)";
  return "var(--lp-orange)";
}

function alertIcon(kind: string): string {
  if (kind === "performance_dip") return "trending_down";
  if (kind === "target_achieved") return "verified";
  if (kind === "pending_drafts") return "edit_note";
  if (kind === "inactive_bde") return "person_off";
  return "info";
}
function alertColor(kind: string): string {
  if (kind === "performance_dip") return "var(--lp-error)";
  if (kind === "target_achieved") return "var(--lp-cyan)";
  if (kind === "pending_drafts") return "var(--lp-orange)";
  if (kind === "inactive_bde") return "var(--lp-orange)";
  return "var(--lp-on-surface-variant)";
}

function QuickActions() {
  return (
    <div className="flex items-center gap-[8px]">
      <Link
        href="/marketing/lead-pulse/monthly-report"
        className="h-[40px] px-[16px] rounded-[8px] text-[13px] font-semibold inline-flex items-center"
        style={{ backgroundColor: "var(--lp-primary)", color: "var(--lp-on-primary)" }}
      >
        Run monthly report
      </Link>
      <Link
        href="/marketing/lead-pulse/team-roster"
        className="h-[40px] px-[16px] rounded-[8px] text-[13px] font-semibold inline-flex items-center border"
        style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
      >
        Team roster
      </Link>
    </div>
  );
}
