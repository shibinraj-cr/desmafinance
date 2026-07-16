import { NextRequest } from "next/server";
import { ImageResponse } from "next/og";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import { getPipelineForecast } from "@/lib/lead-pulse-metrics";
import { resolveServiceMatrix } from "@/lib/lead-pulse-crm-metrics";
import { getScorecardExcludedUserIds } from "@/lib/crm-team";
import { SCORECARD_EXCLUDED_DISPLAY_NAMES } from "@/lib/crm-score";
import { prisma } from "@/lib/prisma";
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

  const [matrix, forecast, bdeInsights] = await Promise.all([
    // Honor the active metrics source (CRM vs daily-entry) so this PNG
    // matches the dashboard / monthly report. Previously this called
    // getServiceConversionMatrix directly, which always read legacy
    // daily-entry closes and diverged from the CRM-sourced on-page card.
    resolveServiceMatrix(year, month),
    getPipelineForecast(year, month),
    prisma.leadPulseBdeInsight.findMany({
      where: { year, month, status: "answered" },
      select: { userId: true, answers: true },
    }),
  ]);

  // Team leads oversee the team but aren't scored individual contributors —
  // drop them so the PNG matches the on-screen card (role marker + the
  // name-based belt-and-suspenders list, same as the L2 Scorecard).
  const excludedIds = await getScorecardExcludedUserIds(matrix.bdes.map((b) => b.userId));
  const rows = matrix.bdes
    .filter(
      (b) =>
        !excludedIds.has(b.userId) &&
        !SCORECARD_EXCLUDED_DISPLAY_NAMES.includes(b.displayName.trim().toLowerCase()),
    )
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
        userId: b.userId,
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

  // Build the AI Insights bullets in priority order. Cap to ~6 so the
  // PNG stays scannable on a phone.
  type Bullet = { icon: string; tone: "warn" | "info" | "good"; text: string };
  const bullets: Bullet[] = [];

  // Pipeline-driven team headline
  const totalExpectedRev = forecast.byBde.reduce((a, b) => a + b.totals.expectedRevenue, 0);
  const totalActualRev = forecast.byBde.reduce((a, b) => a + b.totals.actualRevenue, 0);
  const totalOpen = forecast.byBde.reduce((a, b) => a + b.totals.openCount, 0);
  if (totalOpen > 0 || totalExpectedRev > 0) {
    bullets.push({
      icon: "•",
      tone: "info",
      text: `${totalOpen} open deal${totalOpen === 1 ? "" : "s"} in pipeline · ₹${totalExpectedRev.toLocaleString("en-IN")} expected revenue (₹${totalActualRev.toLocaleString("en-IN")} already closed).`,
    });
  }

  // Behind-target BDEs (>= 30% gap) get a warn bullet
  const behind = rows
    .filter((r) => r.pct != null && r.pct < 70 && r.target > 0)
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
  for (const r of behind.slice(0, 3)) {
    const gap = Math.max(1, Math.ceil(r.target - r.actual));
    bullets.push({
      icon: "▼",
      tone: "warn",
      text: `${r.name} is behind by ${gap} close${gap === 1 ? "" : "s"} (${r.pct!.toFixed(0)}% of target).`,
    });
  }

  // Thin pipeline relative to target
  for (const b of forecast.byBde) {
    if (b.totals.targetCount === 0) continue;
    const desired = Math.max(b.totals.targetCount * 2, 6);
    if (b.totals.openCount < desired) {
      bullets.push({
        icon: "△",
        tone: "warn",
        text: `${b.displayName}'s pipeline is thin — ${b.totals.openCount} open vs ~${desired} typically needed to hit ${b.totals.targetCount}.`,
      });
    }
    if (bullets.length >= 6) break;
  }

  // BDE answer signals — only when a BDE's behind. Scan their answers
  // for known blockers and surface the alarming ones.
  const insightByUserId = new Map<string, string>();
  for (const ins of bdeInsights) {
    if (!ins.answers) continue;
    const text = Object.values(ins.answers as Record<string, string>).join(" ");
    insightByUserId.set(ins.userId, text);
  }
  for (const r of rows) {
    if (bullets.length >= 6) break;
    const text = (insightByUserId.get(r.userId) ?? "").toLowerCase();
    if (!text) continue;
    if (/budget|cost|expensive|cannot afford|can'?t afford|emi|fees?/i.test(text)) {
      bullets.push({
        icon: "!",
        tone: "warn",
        text: `${r.name} flagged BUDGET as blocker in answers — review EMI / split-payment offers.`,
      });
    } else if (/document|paperwork|attestation|passport|certificate/i.test(text)) {
      bullets.push({
        icon: "!",
        tone: "warn",
        text: `${r.name} flagged DOCUMENT delays in answers — send checklists today.`,
      });
    } else if (/follow.?up|callback|no answer|not picking|did not respond|did not answer/i.test(text)) {
      bullets.push({
        icon: "!",
        tone: "warn",
        text: `${r.name} flagged FOLLOW-UP gaps — schedule a call-bank slot tomorrow.`,
      });
    }
  }

  // Closing positive note if team is hitting target
  if (teamPct != null && teamPct >= 100 && bullets.length < 6) {
    bullets.push({
      icon: "★",
      tone: "good",
      text: `Team has cleared the ${teamTarget}-deal target this month. Keep pipeline filling for next month.`,
    });
  }
  if (bullets.length === 0) {
    bullets.push({
      icon: "•",
      tone: "info",
      text: `Nothing alarming surfaced from this month's numbers. Keep momentum on open pipeline.`,
    });
  }
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
            marginBottom: 14,
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

        {/* AI Insights — pipeline analysis + alarming answer signals */}
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
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span
              style={{
                display: "flex",
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: GOLD,
                color: BG,
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 800,
              }}
            >
              ✦
            </span>
            <span
              style={{
                display: "flex",
                fontSize: 13,
                color: GOLD,
                textTransform: "uppercase",
                letterSpacing: 2,
                fontWeight: 700,
              }}
            >
              AI Insights
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {bullets.slice(0, 6).map((b, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  fontSize: 17,
                  lineHeight: 1.35,
                }}
              >
                <span
                  style={{
                    display: "flex",
                    width: 22,
                    minWidth: 22,
                    height: 22,
                    borderRadius: 6,
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 800,
                    backgroundColor:
                      b.tone === "warn"
                        ? "rgba(255, 182, 171, 0.18)"
                        : b.tone === "good"
                          ? "rgba(51, 228, 255, 0.18)"
                          : "rgba(250, 204, 21, 0.18)",
                    color:
                      b.tone === "warn" ? RED : b.tone === "good" ? CYAN : GOLD,
                  }}
                >
                  {b.icon}
                </span>
                <span
                  style={{
                    display: "flex",
                    flex: 1,
                    color: TEXT,
                  }}
                >
                  {b.text}
                </span>
              </div>
            ))}
          </div>
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
        // This report reflects live numbers, so it must never be cached.
        // next/og's ImageResponse otherwise defaults to a long-lived,
        // immutable Cache-Control, which made browsers serve a stale PNG
        // (a user who downloaded once kept getting the old figures).
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
