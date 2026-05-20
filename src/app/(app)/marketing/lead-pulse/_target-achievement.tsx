import Link from "next/link";
import type { ServiceMatrix } from "@/lib/lead-pulse-metrics";
import { TargetAchievementChart } from "./_charts";

/**
 * Roll the (BDE × ServiceGroup) cells in the matrix up to per-BDE
 * totals, then render the achievement card (KPI tiles + chart +
 * per-BDE table + auto-analysis). Shared between the Lead Pulse
 * dashboard and the Monthly Report page so both views read off the
 * same data and styling.
 */
export function TargetAchievementCard({
  matrix,
  monthLabel,
  year,
  month,
}: {
  matrix: ServiceMatrix;
  monthLabel: string;
  /** Year + month drive the Download PNG link. Optional so older
   *  callers still compile while we wire them through. */
  year?: number;
  month?: number;
}) {
  const rows = matrix.bdes
    .map((b) => {
      let actual = 0;
      let target = 0;
      for (const s of matrix.services) {
        const c = matrix.cells.get(`${b.userId}|${s.id}`);
        if (!c) continue;
        actual += c.actual;
        target += c.target;
      }
      return {
        name: b.displayName,
        actual: Math.round(actual * 10) / 10,
        target,
        pct: target > 0 ? Math.round((actual / target) * 1000) / 10 : null,
      };
    })
    .filter((r) => r.actual > 0 || r.target > 0)
    .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.actual - a.actual);
  const teamActual = rows.reduce((a, r) => a + r.actual, 0);
  const teamTarget = rows.reduce((a, r) => a + r.target, 0);
  const teamPct = teamTarget > 0 ? Math.round((teamActual / teamTarget) * 1000) / 10 : null;
  const leader = rows.find((r) => r.pct != null);
  const trailing = [...rows].filter((r) => r.pct != null).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0))[0];
  const noTargets = rows.every((r) => r.target === 0);

  function tone(pct: number | null) {
    if (pct == null) return "var(--lp-on-surface-variant)";
    if (pct >= 100) return "var(--lp-cyan)";
    if (pct >= 70) return "var(--lp-primary)";
    return "var(--lp-error)";
  }

  return (
    <div
      className="rounded-[12px] border"
      style={{
        backgroundColor: "var(--lp-surface-container)",
        borderColor: "var(--lp-outline-variant)",
      }}
    >
      <div
        className="px-[20px] pt-[16px] pb-[8px] flex items-center justify-between"
      >
        <span className="text-[14px] font-semibold" style={{ color: "var(--lp-on-surface)" }}>
          Monthly Target Achievement — {monthLabel}
        </span>
        {year != null && month != null && (
          <a
            href={`/api/marketing/lead-pulse/target-achievement/og?year=${year}&month=${month}`}
            className="inline-flex items-center gap-[6px] h-[28px] px-[10px] rounded-[8px] text-[11px] font-semibold border"
            style={{
              borderColor: "var(--lp-primary)",
              backgroundColor: "rgba(250, 204, 21, 0.10)",
              color: "var(--lp-primary)",
            }}
            title="Download a mobile-friendly PNG snapshot of this card for WhatsApp"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>
              download
            </span>
            Download PNG
          </a>
        )}
      </div>
      <div className="px-[20px] pb-[16px]">
        {rows.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            No active L2 BDEs with targets or closes yet for this month.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px] mb-[12px]">
              <KpiTile label="Team Actual" value={Math.round(teamActual * 10) / 10} color="var(--lp-primary)" />
              <KpiTile label="Team Target" value={teamTarget} color="var(--lp-cyan)" />
              <KpiTile
                label="Achievement"
                value={teamPct == null ? "—" : `${teamPct.toFixed(1)}%`}
                color={tone(teamPct)}
                highlight={teamPct != null && teamPct >= 100}
              />
            </div>
            <TargetAchievementChart
              data={rows.map((r) => ({ name: r.name, actual: r.actual, target: r.target }))}
            />
            <div
              className="flex items-center gap-[16px] mt-[6px] text-[11px]"
              style={{ color: "var(--lp-on-surface-variant)" }}
            >
              <Legend color="var(--lp-primary)" label="Actual" />
              <Legend color="var(--lp-cyan)" label="Target" />
            </div>

            <table className="w-full text-[12px] tabular-nums mt-[12px]">
              <thead>
                <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
                  <Th>BDE</Th>
                  <Th align="right">Actual</Th>
                  <Th align="right">Target</Th>
                  <Th align="right">Achievement</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.name}
                    className="border-t"
                    style={{ borderColor: "var(--lp-outline-variant)" }}
                  >
                    <td className="px-[12px] py-[6px] font-semibold">{r.name}</td>
                    <td className="px-[12px] py-[6px] text-right" style={{ color: "var(--lp-primary)" }}>
                      {r.actual}
                    </td>
                    <td className="px-[12px] py-[6px] text-right" style={{ color: "var(--lp-cyan)" }}>
                      {r.target}
                    </td>
                    <td
                      className="px-[12px] py-[6px] text-right font-semibold"
                      style={{ color: tone(r.pct) }}
                    >
                      {r.pct == null ? "no target" : `${r.pct.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
                <tr
                  className="border-t"
                  style={{
                    borderColor: "var(--lp-outline-variant)",
                    backgroundColor: "var(--lp-surface-container-low)",
                  }}
                >
                  <td
                    className="px-[12px] py-[6px] font-semibold uppercase text-[11px]"
                    style={{ color: "var(--lp-on-surface-variant)" }}
                  >
                    Team
                  </td>
                  <td
                    className="px-[12px] py-[6px] text-right font-bold"
                    style={{ color: "var(--lp-primary)" }}
                  >
                    {Math.round(teamActual * 10) / 10}
                  </td>
                  <td
                    className="px-[12px] py-[6px] text-right font-bold"
                    style={{ color: "var(--lp-cyan)" }}
                  >
                    {teamTarget}
                  </td>
                  <td
                    className="px-[12px] py-[6px] text-right font-bold"
                    style={{ color: tone(teamPct) }}
                  >
                    {teamPct == null ? "no target" : `${teamPct.toFixed(1)}%`}
                  </td>
                </tr>
              </tbody>
            </table>

            <div
              className="mt-[10px] rounded-[10px] border p-[12px] flex items-start gap-[10px]"
              style={{
                backgroundColor: "var(--lp-surface-container-low)",
                borderColor:
                  teamPct != null && teamPct >= 100
                    ? "rgba(51, 228, 255, 0.45)"
                    : "var(--lp-outline-variant)",
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 18, color: tone(teamPct) }}
                aria-hidden
              >
                auto_awesome
              </span>
              <div className="flex-1 text-[12px]" style={{ color: "var(--lp-on-surface)" }}>
                <p
                  className="text-[10px] uppercase tracking-widest font-semibold mb-[4px]"
                  style={{ color: "var(--lp-primary)" }}
                >
                  Analysis
                </p>
                {noTargets ? (
                  <p>
                    No monthly targets set for this period — head to{" "}
                    <Link
                      href="/marketing/lead-pulse/targets"
                      className="underline"
                      style={{ color: "var(--lp-primary)" }}
                    >
                      L2 Service Targets
                    </Link>{" "}
                    to define them.
                  </p>
                ) : (
                  <ul className="space-y-[3px]">
                    <li>
                      Team is at{" "}
                      <span className="font-semibold">
                        {teamPct == null ? "—" : `${teamPct.toFixed(1)}%`}
                      </span>{" "}
                      of monthly target ({Math.round(teamActual * 10) / 10} of {teamTarget}{" "}
                      {teamTarget === 1 ? "close" : "closes"}).
                      {teamPct != null && teamPct < 100 && (
                        <>
                          {" "}
                          Still {(teamTarget - teamActual).toFixed(1)} to go.
                        </>
                      )}
                    </li>
                    {leader && leader.pct != null && (
                      <li>
                        Top of the leaderboard:{" "}
                        <span className="font-semibold">{leader.name}</span> at{" "}
                        {leader.pct.toFixed(1)}% ({leader.actual} of {leader.target}).
                      </li>
                    )}
                    {trailing &&
                      trailing.pct != null &&
                      trailing.name !== leader?.name && (
                        <li>
                          Needs a push:{" "}
                          <span className="font-semibold">{trailing.name}</span> at{" "}
                          {trailing.pct.toFixed(1)}% ({trailing.actual} of {trailing.target}).
                        </li>
                      )}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  color,
  highlight,
}: {
  label: string;
  value: number | string;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-[10px] border p-[12px]"
      style={{
        backgroundColor: "var(--lp-surface-container-low)",
        borderColor: highlight ? color : "var(--lp-outline-variant)",
      }}
    >
      <p
        className="text-[10px] uppercase tracking-widest"
        style={{ color: "var(--lp-on-surface-variant)" }}
      >
        {label}
      </p>
      <p className="text-[26px] font-bold tabular-nums" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className="px-[12px] py-[8px] text-[10px] uppercase tracking-widest font-semibold"
      style={{ color: "var(--lp-on-surface-variant)", textAlign: align ?? "left" }}
    >
      {children}
    </th>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-[4px]">
      <span
        style={{
          width: 10,
          height: 10,
          backgroundColor: color,
          borderRadius: 2,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
