import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { Permissions } from "../rbac";
import { canSeePage, isAdmin } from "../rbac";
import { addDays, fromPrismaDate, istDateString, toPrismaDate, todayIst } from "../lead-pulse-dates";
import { decryptToken } from "./token-crypto";
import {
  GoogleApiError,
  fetchAnalyticsReport,
  fetchMyChannel,
  fetchUploadIds,
  fetchVideoDetails,
  refreshAccessToken,
  youtubeOAuthConfig,
} from "./google";
import {
  YOUTUBE_INSIGHTS_HREF,
  classifyFormat,
  parseIsoDuration,
  type InsightsDay,
  type InsightsVideo,
  type VideoFormat,
} from "./insights-shared";

/**
 * YouTube Insights — server side: access, the Google sync, and the query that
 * lines channel data up against CRM leads day by day. The statistics live in
 * ./insights-shared (pure, shared with the client).
 */
export * from "./insights-shared";

/**
 * Page-grant gated like the Media Planner: the Marketing Admin role gets it via
 * the marketing module's page list without full admin. Anyone who can open the
 * page can also connect/disconnect the channel — the channel owner is usually
 * the marketing admin, not the system admin — and every such action is audited.
 */
export function canUseYouTubeInsights(perms: Permissions | null | undefined): boolean {
  if (!perms) return false;
  return isAdmin(perms) || canSeePage(perms, YOUTUBE_INSIGHTS_HREF);
}

/** First sync pulls this much channel history; later syncs re-pull a week. */
export const BACKFILL_DAYS = 730;
/** YouTube revises the last couple of days as late data lands. */
export const RESYNC_DAYS = 7;

export type SyncResult = {
  channelTitle: string;
  videos: number;
  days: number;
  from: string | null;
  to: string | null;
  warning: string | null;
};

async function recordSync(id: string, ok: boolean, error: string | null) {
  await prisma.youTubeConnection.update({
    where: { id },
    data: { lastSyncAt: new Date(), lastSyncOk: ok, lastSyncError: error },
  });
}

/**
 * Pull uploads + daily channel analytics for the connected channel. Throws on
 * failure after recording the reason on the connection (so the page can say
 * "reconnect" instead of silently showing stale numbers).
 */
export async function syncYouTube(opts: { full?: boolean } = {}): Promise<SyncResult | null> {
  const conn = await prisma.youTubeConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!conn) return null;
  if (!youtubeOAuthConfig()) {
    await recordSync(conn.id, false, "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not set on the server.");
    throw new Error("YouTube OAuth client is not configured");
  }

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(decryptToken(conn.refreshTokenEnc));
  } catch (e) {
    const revoked = e instanceof GoogleApiError && e.code === "invalid_grant";
    const msg = revoked
      ? "Google access was revoked or expired — reconnect the channel. (If this repeats weekly, the OAuth consent screen is still in Testing mode.)"
      : e instanceof GoogleApiError
        ? `Google sign-in failed: ${e.message}`
        : "Stored credential could not be read — reconnect the channel.";
    await recordSync(conn.id, false, msg);
    throw e;
  }

  try {
    // ── Uploads ────────────────────────────────────────────────────────────
    let playlistId = conn.uploadsPlaylistId;
    if (!playlistId) {
      const ch = await fetchMyChannel(accessToken);
      playlistId = ch?.uploadsPlaylistId ?? null;
      if (playlistId) {
        await prisma.youTubeConnection.update({ where: { id: conn.id }, data: { uploadsPlaylistId: playlistId } });
      }
    }
    let videoCount = 0;
    if (playlistId) {
      const ids = await fetchUploadIds(accessToken, playlistId);
      const details = await fetchVideoDetails(accessToken, ids);
      for (let i = 0; i < details.length; i += 100) {
        await prisma.$transaction(
          details.slice(i, i + 100).map((v) => {
            const publishedAt = new Date(v.publishedAt);
            const durationSec = parseIsoDuration(v.durationIso);
            const data = {
              channelId: conn.channelId,
              title: v.title.slice(0, 500),
              publishedAt,
              publishDay: toPrismaDate(istDateString(publishedAt)),
              durationSec,
              format: classifyFormat(durationSec, v.isLive),
              viewCount: v.viewCount,
              likeCount: v.likeCount,
              commentCount: v.commentCount,
              thumbnailUrl: v.thumbnailUrl,
            };
            return prisma.youTubeVideo.upsert({ where: { id: v.id }, create: { id: v.id, ...data }, update: data });
          }),
        );
      }
      videoCount = details.length;
    }

    // ── Daily channel analytics ────────────────────────────────────────────
    const today = todayIst();
    const end = addDays(today, -1);
    const latest = opts.full
      ? null
      : await prisma.youTubeChannelDay.findFirst({
          where: { channelId: conn.channelId },
          orderBy: { day: "desc" },
          select: { day: true },
        });
    const start = latest ? addDays(fromPrismaDate(latest.day), -RESYNC_DAYS) : addDays(today, -BACKFILL_DAYS);

    let dayCount = 0;
    let warning: string | null = null;
    if (start <= end) {
      const totals = await fetchAnalyticsReport(accessToken, {
        startDate: start,
        endDate: end,
        metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
        dimensions: "day",
      });
      const col = (h: string) => totals.headers.indexOf(h);
      type Row = {
        views: number;
        shortsViews: number;
        videoViews: number;
        liveViews: number;
        watchMinutes: number;
        subscribersGained: number;
        subscribersLost: number;
      };
      const byDay = new Map<string, Row>();
      for (const r of totals.rows) {
        byDay.set(String(r[col("day")]), {
          views: Number(r[col("views")]) || 0,
          shortsViews: 0,
          videoViews: 0,
          liveViews: 0,
          watchMinutes: Math.round(Number(r[col("estimatedMinutesWatched")]) || 0),
          subscribersGained: Number(r[col("subscribersGained")]) || 0,
          subscribersLost: Number(r[col("subscribersLost")]) || 0,
        });
      }

      // Shorts vs long-form split. A failure here keeps the totals and says so.
      try {
        const split = await fetchAnalyticsReport(accessToken, {
          startDate: start,
          endDate: end,
          metrics: "views",
          dimensions: "day,creatorContentType",
        });
        const d = split.headers.indexOf("day");
        const t = split.headers.indexOf("creatorContentType");
        const v = split.headers.indexOf("views");
        for (const r of split.rows) {
          const row = byDay.get(String(r[d]));
          if (!row) continue;
          const views = Number(r[v]) || 0;
          const type = String(r[t]).toUpperCase();
          if (type === "SHORTS") row.shortsViews += views;
          else if (type === "VIDEO_ON_DEMAND") row.videoViews += views;
          else if (type === "LIVE_STREAM") row.liveViews += views;
        }
      } catch (e) {
        warning = `Shorts/long-video view split unavailable: ${e instanceof Error ? e.message : String(e)}`;
      }

      const rows = Array.from(byDay.entries()).map(([day, r]) => ({
        channelId: conn.channelId,
        day: toPrismaDate(day),
        ...r,
      }));
      await prisma.$transaction([
        prisma.youTubeChannelDay.deleteMany({
          where: { channelId: conn.channelId, day: { gte: toPrismaDate(start), lte: toPrismaDate(end) } },
        }),
        prisma.youTubeChannelDay.createMany({ data: rows }),
      ]);
      dayCount = rows.length;
    }

    await recordSync(conn.id, true, warning);
    return {
      channelTitle: conn.channelTitle,
      videos: videoCount,
      days: dayCount,
      from: start <= end ? start : null,
      to: start <= end ? end : null,
      warning,
    };
  } catch (e) {
    const msg = e instanceof GoogleApiError ? `YouTube API error: ${e.message}` : e instanceof Error ? e.message : String(e);
    await recordSync(conn.id, false, msg.slice(0, 1000));
    throw e;
  }
}

// ─── The analysis dataset ─────────────────────────────────────────────────

/** Start of an IST calendar day as a UTC instant. */
function istStart(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

/**
 * Every day in [from, to] with channel numbers, uploads, CRM leads and Voxbay
 * callers side by side. Leads are CRM leads created that IST day whose source
 * is YouTube or Voxbay, excluding leads parked as duplicates. Re-enrollment
 * leads carry source "Existing Candidate" and are deliberately NOT counted via
 * their originalSource — a second service for an existing candidate is not a
 * fresh enquiry the channel produced.
 */
export async function loadInsights(
  from: string,
  to: string,
): Promise<{ days: InsightsDay[]; videos: InsightsVideo[]; channelId: string | null }> {
  const conn = await prisma.youTubeConnection.findFirst({
    orderBy: { createdAt: "desc" },
    select: { channelId: true },
  });
  const channelId = conn?.channelId ?? null;
  const fromUtc = istStart(from);
  const toUtcExcl = istStart(addDays(to, 1));

  const [channelDays, videos, leadRows, callerRows, coverage] = await Promise.all([
    channelId
      ? prisma.youTubeChannelDay.findMany({
          where: { channelId, day: { gte: toPrismaDate(from), lte: toPrismaDate(to) } },
        })
      : Promise.resolve([]),
    channelId
      ? prisma.youTubeVideo.findMany({
          where: { channelId, publishDay: { gte: toPrismaDate(from), lte: toPrismaDate(to) } },
          orderBy: { publishedAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.$queryRaw<Array<{ day: string; src: string; n: number }>>(Prisma.sql`
      SELECT to_char((l."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day,
             CASE WHEN s.code ILIKE '%youtube%' OR s.label ILIKE '%youtube%' THEN 'youtube' ELSE 'voxbay' END AS src,
             COUNT(*)::int AS n
      FROM "Lead" l
      JOIN "LeadPulseSource" s ON s.id = l."sourceId"
      JOIN "CrmLeadStatus" st ON st.id = l."statusId"
      WHERE st.code <> 'duplicate'
        AND (s.code ILIKE '%youtube%' OR s.label ILIKE '%youtube%' OR s.code ILIKE '%voxbay%' OR s.label ILIKE '%voxbay%')
        AND l."createdAt" >= ${fromUtc} AND l."createdAt" < ${toUtcExcl}
      GROUP BY 1, 2
    `),
    prisma.$queryRaw<Array<{ day: string; n: number }>>(Prisma.sql`
      SELECT to_char(("callStartTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS day,
             COUNT(DISTINCT "sourceNumber")::int AS n
      FROM "VoxbayCall"
      WHERE "callStartTime" >= ${fromUtc} AND "callStartTime" < ${toUtcExcl}
      GROUP BY 1
    `),
    prisma.voxbayCall.aggregate({ _min: { callStartTime: true }, _max: { callStartTime: true } }),
  ]);

  const chByDay = new Map(channelDays.map((c) => [fromPrismaDate(c.day), c]));
  const leads = new Map<string, { youtube: number; voxbay: number }>();
  for (const r of leadRows) {
    const e = leads.get(r.day) ?? { youtube: 0, voxbay: 0 };
    e[r.src === "youtube" ? "youtube" : "voxbay"] += Number(r.n);
    leads.set(r.day, e);
  }
  const callers = new Map(callerRows.map((r) => [r.day, Number(r.n)]));
  const covFrom = coverage._min.callStartTime ? istDateString(coverage._min.callStartTime) : null;
  const covTo = coverage._max.callStartTime ? istDateString(coverage._max.callStartTime) : null;

  const uploads = new Map<string, { short: number; video: number }>();
  const outVideos: InsightsVideo[] = videos.map((v) => {
    const day = fromPrismaDate(v.publishDay);
    const u = uploads.get(day) ?? { short: 0, video: 0 };
    if (v.format === "short") u.short += 1;
    else u.video += 1;
    uploads.set(day, u);
    return {
      id: v.id,
      title: v.title,
      publishDay: day,
      format: v.format as VideoFormat,
      viewCount: v.viewCount,
      thumbnailUrl: v.thumbnailUrl,
    };
  });

  const days: InsightsDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = chByDay.get(d);
    const l = leads.get(d);
    const u = uploads.get(d);
    const inCoverage = covFrom !== null && covTo !== null && d >= covFrom && d <= covTo;
    days.push({
      day: d,
      views: c ? c.views : null,
      shortsViews: c ? c.shortsViews : null,
      videoViews: c ? c.videoViews : null,
      subscribersNet: c ? c.subscribersGained - c.subscribersLost : null,
      shortsPublished: u?.short ?? 0,
      videosPublished: u?.video ?? 0,
      ytLeads: l?.youtube ?? 0,
      voxbayLeads: l?.voxbay ?? 0,
      voxbayCallers: inCoverage ? (callers.get(d) ?? 0) : null,
    });
  }
  return { days, videos: outVideos, channelId };
}
