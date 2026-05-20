import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { getServiceConversionMatrix } from "@/lib/lead-pulse-metrics";
import { todayIst } from "@/lib/lead-pulse-dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BG = "#171302";
const SURFACE = "#1f1a08";
const SURFACE_LOW = "#2a2310";
const TEXT = "#ebe2d0";
const TEXT_DIM = "#a89d80";
const GOLD = "#facc15";
const CYAN = "#33e4ff";
const RED = "#ffb6ab";

function toneColor(pct: number | null): string {
  if (pct == null) return TEXT_DIM;
  if (pct >= 100) return CYAN;
  if (pct >= 70) return GOLD;
  return RED;
}

/**
 * GET /api/marketing/lead-pulse/target-achievement/og?year=YYYY&month=MM
 *
 * 720×1280 portrait PNG of the team's Monthly Target Achievement
 * card. Suhaina's WhatsApp share path: open the dashboard → click
 * the Download PNG button on the Monthly Target Achievement card →
 * browser saves the file → drop into the team group chat.
 *
 * Supervisor-only — same gate as the dashboard itself.
 */
export async function GET(req: NextRequest) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return new Response("unauthorized", { status: 401 });
  const access = await getLeadPulseAccess(userId, perms);
  if (!access.canSupervise) return new Response("forbidden", { status: 403 });

  const url = new URL(req.url);
  const today = todayIst();
  const year = Number(url.searchParams.get("year")) || Number(today.slice(0, 4));
  const month = Number(url.searchParams.get("month")) || Number(today.slice(5, 7));

  const matrix = await getServiceConversionMatrix(year, month);

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
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
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
            DESGRO · Lead Pulse · Team Target Achievement
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <span style={{ fontSize: 44, fontWeight: 800, color: TEXT }}>{monthLabel}</span>
          </div>
        </div>

        {/* Team KPIs */}
        <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
          <KpiTile label="Team Actual" value={teamActual.toString()} color={GOLD} />
          <KpiTile label="Team Target" value={teamTarget.toString()} color={CYAN} />
          <KpiTile
            label="Achievement"
            value={teamPct == null ? "—" : `${teamPct.toFixed(1)}%`}
            color={toneColor(teamPct)}
          />
        </div>

        {/* Per-BDE table */}
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
              marginBottom: 10,
            }}
          >
            Per-BDE
          </div>
          {rows.length === 0 ? (
            <div style={{ display: "flex", color: TEXT_DIM, fontSize: 16 }}>
              No active L2 BDEs with targets or closes yet for this month.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
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
                <span style={{ flex: 1, display: "flex" }}>BDE</span>
                <span style={{ width: 110, display: "flex", justifyContent: "flex-end" }}>Actual</span>
                <span style={{ width: 110, display: "flex", justifyContent: "flex-end" }}>Target</span>
                <span style={{ width: 140, display: "flex", justifyContent: "flex-end" }}>Achievement</span>
              </div>
              {rows.map((r) => (
                <div
                  key={r.name}
                  style={{
                    display: "flex",
                    fontSize: 20,
                    color: TEXT,
                    paddingBottom: 6,
                    borderBottom: `1px solid ${SURFACE_LOW}`,
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ flex: 1, display: "flex", fontWeight: 600 }}>{r.name}</span>
                  <span
                    style={{
                      width: 110,
                      display: "flex",
                      justifyContent: "flex-end",
                      color: GOLD,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {r.actual}
                  </span>
                  <span
                    style={{
                      width: 110,
                      display: "flex",
                      justifyContent: "flex-end",
                      color: CYAN,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {r.target}
                  </span>
                  <span
                    style={{
                      width: 140,
                      display: "flex",
                      justifyContent: "flex-end",
                      color: toneColor(r.pct),
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {r.pct == null ? "no target" : `${r.pct.toFixed(1)}%`}
                  </span>
                </div>
              ))}
              {/* Team total row */}
              <div
                style={{
                  display: "flex",
                  fontSize: 20,
                  color: TEXT,
                  paddingTop: 8,
                  marginTop: 4,
                  borderTop: `2px solid ${SURFACE_LOW}`,
                  alignItems: "baseline",
                  fontWeight: 800,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    display: "flex",
                    fontSize: 13,
                    color: TEXT_DIM,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                  }}
                >
                  Team
                </span>
                <span
                  style={{
                    width: 110,
                    display: "flex",
                    justifyContent: "flex-end",
                    color: GOLD,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {teamActual}
                </span>
                <span
                  style={{
                    width: 110,
                    display: "flex",
                    justifyContent: "flex-end",
                    color: CYAN,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {teamTarget}
                </span>
                <span
                  style={{
                    width: 140,
                    display: "flex",
                    justifyContent: "flex-end",
                    color: toneColor(teamPct),
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {teamPct == null ? "no target" : `${teamPct.toFixed(1)}%`}
                </span>
              </div>
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
          <span style={{ display: "flex" }}>generated {generatedAt} IST</span>
          <span style={{ display: "flex" }}>desgro.vercel.app</span>
        </div>
      </div>
    ),
    {
      width: 720,
      height: 1280,
      headers: {
        "Content-Disposition": `attachment; filename="team-target-achievement-${year}-${String(month).padStart(2, "0")}.png"`,
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
        flex: 1,
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
      <span style={{ display: "flex", fontSize: 36, fontWeight: 800, color }}>{value}</span>
    </div>
  );
}
