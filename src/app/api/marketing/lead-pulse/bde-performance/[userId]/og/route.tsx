import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import {
  getFunnelTotals,
  getFunnelBySource,
  getPipelineForecast,
  monthBounds,
} from "@/lib/lead-pulse-metrics";
import { addDays, todayIst } from "@/lib/lead-pulse-dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BG = "#171302";
const SURFACE = "#1f1a08";
const SURFACE_LOW = "#2a2310";
const TEXT = "#ebe2d0";
const TEXT_DIM = "#a89d80";
const GOLD = "#facc15";
const CYAN = "#33e4ff";
const ORANGE = "#ffb693";
const RED = "#ffb6ab";

/**
 * GET /api/marketing/lead-pulse/bde-performance/[userId]/og?range=30d|90d|ytd|all|month&year=YYYY&month=MM
 *
 * Returns a 720×1280 PNG portrait snapshot of the BDE's key numbers
 * formatted for WhatsApp sharing. Suhaina hits a Download button on
 * the desktop dashboard → this route renders the mobile-friendly
 * version → browser saves it as a `.png` file.
 *
 * Built on next/og (Satori). Layout uses pure inline styles + flex —
 * no CSS variables, no grid.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { userId: string } },
) {
  const { userId: actorId, perms } = await getCurrentUserAndPermissions();
  if (!actorId || !perms) {
    return new Response("unauthorized", { status: 401 });
  }
  const access = await getLeadPulseAccess(actorId, perms);
  if (params.userId !== actorId && !access.canSupervise) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const rangeRaw = url.searchParams.get("range");
  const range =
    rangeRaw === "30d" || rangeRaw === "90d" || rangeRaw === "ytd" || rangeRaw === "all" || rangeRaw === "month"
      ? rangeRaw
      : "30d";
  const today = todayIst();
  const yearNow = Number(today.slice(0, 4));
  const monthNow = Number(today.slice(5, 7));
  const pickYear = url.searchParams.get("year") ? Number(url.searchParams.get("year")) : yearNow;
  const pickMonth = url.searchParams.get("month") ? Number(url.searchParams.get("month")) : monthNow;

  let start: string;
  let end: string = today;
  let rangeLabel: string;
  if (range === "30d") {
    start = addDays(today, -29);
    rangeLabel = "Last 30 days";
  } else if (range === "90d") {
    start = addDays(today, -89);
    rangeLabel = "Last 90 days";
  } else if (range === "ytd") {
    start = `${today.slice(0, 4)}-01-01`;
    rangeLabel = `YTD ${today.slice(0, 4)}`;
  } else if (range === "month") {
    const mb = monthBounds(pickYear, pickMonth);
    start = mb.start;
    end = mb.end > today ? today : mb.end;
    rangeLabel = new Date(Date.UTC(pickYear, pickMonth - 1, 1)).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
  } else {
    start = "2000-01-01";
    rangeLabel = "All time";
  }

  const target = await prisma.user.findUnique({
    where: { id: params.userId },
    include: { leadPulseRole: true },
  });
  if (!target || !target.leadPulseRole) {
    return new Response("not found", { status: 404 });
  }
  const role = target.leadPulseRole.role as "l1" | "l2";

  const [totals, teamTotals, sourceRows, pipelineForecast] = await Promise.all([
    getFunnelTotals({ start, end, userId: params.userId }),
    getFunnelTotals({ start, end }),
    getFunnelBySource({ start, end }),
    role === "l2"
      ? getPipelineForecast(
          range === "month" ? pickYear : yearNow,
          range === "month" ? pickMonth : monthNow,
          { userId: params.userId },
        )
      : Promise.resolve(null),
  ]);

  const totalLeads = totals.l1Leads + totals.l2Leads;
  const totalWon = role === "l1" ? totals.l1Won : totals.l2Won;
  const totalConv = role === "l1" ? totals.l1ConversionPct : totals.l2ConversionPct;
  const teamTotalLeads = teamTotals.l1Leads + teamTotals.l2Leads;
  const teamConv = teamTotalLeads === 0 ? null : ((teamTotals.l1Won + teamTotals.l2Won) / teamTotalLeads) * 100;
  const personalConv = totalLeads === 0 ? null : ((totals.l1Won + totals.l2Won) / totalLeads) * 100;
  const vsTeam = personalConv != null && teamConv != null ? personalConv - teamConv : null;

  // Per-source for the BDE — top 5 by leads.
  const ownPerSource = await Promise.all(
    sourceRows.map(async (s) => {
      const own = await getFunnelTotals({
        start,
        end,
        userId: params.userId,
        sourceId: s.sourceId,
      });
      const ownLeads = own.l1Leads + own.l2Leads;
      const ownWon = role === "l1" ? own.l1Won : own.l2Won;
      const ownPct = ownLeads ? (ownWon / ownLeads) * 100 : null;
      return { label: s.sourceLabel, leads: ownLeads, won: ownWon, conv: ownPct };
    }),
  );
  const topSources = ownPerSource.filter((s) => s.leads > 0).sort((a, b) => b.leads - a.leads).slice(0, 5);

  // Pipeline summary for L2.
  let pipeline: { open: number; expectedRev: number; target: number; forecast: number } | null = null;
  if (role === "l2" && pipelineForecast) {
    const me = pipelineForecast.byBde.find((b) => b.userId === params.userId);
    if (me) {
      pipeline = {
        open: me.totals.openCount,
        expectedRev: me.totals.expectedRevenue,
        target: me.totals.targetCount,
        forecast: me.totals.forecastCount,
      };
    }
  }

  const fmtMoney = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const fmtPct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
  const fmtPp = (n: number | null) =>
    n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(1)} pp`;

  const generatedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: 720,
          height: 1280,
          display: "flex",
          flexDirection: "column",
          backgroundColor: BG,
          color: TEXT,
          fontFamily: "sans-serif",
          padding: "32px 32px 24px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", flexDirection: "column", marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              fontSize: 14,
              color: GOLD,
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 700,
              marginBottom: 6,
            }}
          >
            DESGRO · Lead Pulse · BDE Performance
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <span style={{ fontSize: 48, fontWeight: 800, color: TEXT }}>
              {target.leadPulseRole.displayName}
            </span>
            <span
              style={{
                display: "flex",
                fontSize: 14,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 999,
                backgroundColor: role === "l2" ? "rgba(51, 228, 255, 0.18)" : "rgba(250, 204, 21, 0.20)",
                color: role === "l2" ? CYAN : GOLD,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {role === "l1" ? "L1 BDE" : "L2 BDE"}
            </span>
          </div>
          <div style={{ display: "flex", fontSize: 18, color: TEXT_DIM, marginTop: 6 }}>
            {rangeLabel}
          </div>
        </div>

        {/* KPI grid 2×2 */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 22 }}>
          <KpiTile label="Total Leads" value={totalLeads.toLocaleString("en-IN")} color={TEXT} />
          <KpiTile
            label={role === "l1" ? "L1 Conversion" : "L2 Conversion"}
            value={fmtPct(totalConv)}
            color={GOLD}
          />
          <KpiTile label="Closed-Won" value={totalWon.toString()} color={CYAN} />
          <KpiTile
            label="vs Team Avg"
            value={fmtPp(vsTeam)}
            color={vsTeam == null ? TEXT_DIM : vsTeam >= 0 ? CYAN : RED}
          />
        </div>

        {/* Pipeline (L2 only) */}
        {pipeline && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              backgroundColor: SURFACE,
              borderRadius: 16,
              padding: 18,
              marginBottom: 18,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 13,
                color: GOLD,
                textTransform: "uppercase",
                letterSpacing: 2,
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              Pipeline this month
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ display: "flex", fontSize: 36, fontWeight: 800, color: GOLD }}>
                {fmtMoney(pipeline.expectedRev)}
              </span>
              <span style={{ display: "flex", fontSize: 14, color: TEXT_DIM }}>
                expected revenue
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 18 }}>
              <span style={{ display: "flex", color: TEXT }}>
                {pipeline.open} open · forecast {pipeline.forecast}
              </span>
              <span
                style={{
                  display: "flex",
                  color: pipeline.target === 0
                    ? TEXT_DIM
                    : pipeline.forecast >= pipeline.target
                      ? CYAN
                      : ORANGE,
                  fontWeight: 700,
                }}
              >
                {pipeline.target === 0
                  ? "No target"
                  : pipeline.forecast >= pipeline.target
                    ? "On track"
                    : `Behind ${pipeline.target - pipeline.forecast}`}
              </span>
            </div>
          </div>
        )}

        {/* Top sources */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            backgroundColor: SURFACE,
            borderRadius: 16,
            padding: 18,
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 13,
              color: GOLD,
              textTransform: "uppercase",
              letterSpacing: 2,
              fontWeight: 700,
              marginBottom: 12,
            }}
          >
            Top Sources
          </div>
          {topSources.length === 0 ? (
            <div style={{ display: "flex", color: TEXT_DIM, fontSize: 16 }}>
              No source data in this window.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  fontSize: 13,
                  color: TEXT_DIM,
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                  paddingBottom: 6,
                  borderBottom: `1px solid ${SURFACE_LOW}`,
                }}
              >
                <span style={{ width: 240, display: "flex" }}>Source</span>
                <span style={{ width: 110, display: "flex", justifyContent: "flex-end" }}>Leads</span>
                <span style={{ width: 90, display: "flex", justifyContent: "flex-end" }}>Won</span>
                <span style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>Conv</span>
              </div>
              {topSources.map((s) => (
                <div
                  key={s.label}
                  style={{
                    display: "flex",
                    fontSize: 18,
                    color: TEXT,
                    paddingBottom: 6,
                    borderBottom: `1px solid ${SURFACE_LOW}`,
                  }}
                >
                  <span style={{ width: 240, display: "flex" }}>{s.label}</span>
                  <span
                    style={{
                      width: 110,
                      display: "flex",
                      justifyContent: "flex-end",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {s.leads}
                  </span>
                  <span
                    style={{
                      width: 90,
                      display: "flex",
                      justifyContent: "flex-end",
                      color: GOLD,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {s.won}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      display: "flex",
                      justifyContent: "flex-end",
                      color: s.conv != null && s.conv >= (teamConv ?? 0) ? CYAN : TEXT,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtPct(s.conv)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 16,
            fontSize: 14,
            color: TEXT_DIM,
          }}
        >
          <span style={{ display: "flex" }}>@{target.username} · generated {generatedAt} IST</span>
          <span style={{ display: "flex" }}>desgro.vercel.app</span>
        </div>
      </div>
    ),
    {
      width: 720,
      height: 1280,
      headers: {
        "Content-Disposition": `attachment; filename="bde-${target.username}-${rangeLabel.replace(/\s+/g, "-").toLowerCase()}.png"`,
        // Live report — never cache (see team target-achievement route).
        "Cache-Control": "no-store, max-age=0, must-revalidate",
      },
    },
  );
}

function KpiTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 314,
        backgroundColor: SURFACE,
        borderRadius: 14,
        padding: 16,
      }}
    >
      <span
        style={{
          display: "flex",
          fontSize: 12,
          color: TEXT_DIM,
          textTransform: "uppercase",
          letterSpacing: 2,
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {label}
      </span>
      <span style={{ display: "flex", fontSize: 40, fontWeight: 800, color }}>{value}</span>
    </div>
  );
}
