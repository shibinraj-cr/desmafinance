/**
 * Thin fetch client for the three Google endpoints YouTube Insights needs:
 * OAuth 2.0 (web-server flow), YouTube Data API v3 (channel + uploads), and
 * YouTube Analytics API v2 (daily channel reports). No googleapis dependency —
 * the surface is small and read-only.
 *
 * Setup (Google Cloud console): enable "YouTube Data API v3" and "YouTube
 * Analytics API", create an OAuth client of type "Web application", add the
 * redirect URI shown on the Insights page, and set YOUTUBE_CLIENT_ID /
 * YOUTUBE_CLIENT_SECRET. Put the consent screen "In production": in Testing
 * mode Google expires refresh tokens after 7 days and the sync silently stops.
 */

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export const YOUTUBE_CALLBACK_PATH = "/api/marketing/youtube/callback";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google's error code, e.g. "invalid_grant" (revoked/expired refresh token). */
    readonly code: string | null,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export function youtubeOAuthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function requireConfig() {
  const c = youtubeOAuthConfig();
  if (!c) throw new Error("YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are not set");
  return c;
}

export function buildAuthUrl(redirectUri: string, state: string): string {
  const { clientId } = requireConfig();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    // offline + consent: always hand back a refresh token, even on a reconnect.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & {
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new GoogleApiError(
      json.error_description || json.error || `token endpoint returned ${res.status}`,
      res.status,
      json.error ?? null,
    );
  }
  return json as TokenResponse;
}

export function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = requireConfig();
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = requireConfig();
  const t = await tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  return t.access_token;
}

/** Best effort — a failed revoke must not block a disconnect. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    cache: "no-store",
  }).catch(() => undefined);
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> };
  };
  if (!res.ok) {
    const err = json.error;
    throw new GoogleApiError(
      err?.message || `${url.split("?")[0]} returned ${res.status}`,
      res.status,
      err?.errors?.[0]?.reason ?? err?.status ?? null,
    );
  }
  return json;
}

export type ChannelInfo = {
  id: string;
  title: string;
  uploadsPlaylistId: string | null;
};

/** The channel the consenting account chose (brand-account channels included). */
export async function fetchMyChannel(accessToken: string): Promise<ChannelInfo | null> {
  const json = await getJson<{
    items?: Array<{
      id: string;
      snippet?: { title?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
  }>("https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true", accessToken);
  const ch = json.items?.[0];
  if (!ch) return null;
  return {
    id: ch.id,
    title: ch.snippet?.title ?? ch.id,
    uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

/** Every video id in the uploads playlist, newest first. Capped for safety. */
export async function fetchUploadIds(accessToken: string, playlistId: string, cap = 5000): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ part: "contentDetails", playlistId, maxResults: "50" });
    if (pageToken) p.set("pageToken", pageToken);
    const json = await getJson<{
      nextPageToken?: string;
      items?: Array<{ contentDetails?: { videoId?: string } }>;
    }>(`https://www.googleapis.com/youtube/v3/playlistItems?${p.toString()}`, accessToken);
    for (const it of json.items ?? []) {
      if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    }
    pageToken = json.nextPageToken;
  } while (pageToken && ids.length < cap);
  return ids;
}

export type VideoDetails = {
  id: string;
  title: string;
  publishedAt: string;
  durationIso: string;
  isLive: boolean;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  thumbnailUrl: string | null;
};

export async function fetchVideoDetails(accessToken: string, ids: string[]): Promise<VideoDetails[]> {
  const out: VideoDetails[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const p = new URLSearchParams({
      part: "snippet,contentDetails,statistics,liveStreamingDetails",
      id: batch.join(","),
      maxResults: "50",
    });
    const json = await getJson<{
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          publishedAt?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
        contentDetails?: { duration?: string };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
        liveStreamingDetails?: unknown;
      }>;
    }>(`https://www.googleapis.com/youtube/v3/videos?${p.toString()}`, accessToken);
    for (const v of json.items ?? []) {
      if (!v.snippet?.publishedAt) continue;
      const thumbs = v.snippet.thumbnails ?? {};
      out.push({
        id: v.id,
        title: v.snippet.title ?? v.id,
        publishedAt: v.snippet.publishedAt,
        durationIso: v.contentDetails?.duration ?? "PT0S",
        isLive: v.liveStreamingDetails != null,
        viewCount: Number(v.statistics?.viewCount ?? 0) || 0,
        likeCount: Number(v.statistics?.likeCount ?? 0) || 0,
        commentCount: Number(v.statistics?.commentCount ?? 0) || 0,
        thumbnailUrl: thumbs.medium?.url ?? thumbs.default?.url ?? null,
      });
    }
  }
  return out;
}

export type AnalyticsReport = { headers: string[]; rows: Array<Array<string | number>> };

/** One YouTube Analytics v2 report for the authorised channel. */
export async function fetchAnalyticsReport(
  accessToken: string,
  opts: { startDate: string; endDate: string; metrics: string; dimensions: string },
): Promise<AnalyticsReport> {
  const p = new URLSearchParams({
    ids: "channel==MINE",
    startDate: opts.startDate,
    endDate: opts.endDate,
    metrics: opts.metrics,
    dimensions: opts.dimensions,
    sort: "day",
  });
  const json = await getJson<{
    columnHeaders?: Array<{ name: string }>;
    rows?: Array<Array<string | number>>;
  }>(`https://youtubeanalytics.googleapis.com/v2/reports?${p.toString()}`, accessToken);
  return { headers: (json.columnHeaders ?? []).map((h) => h.name), rows: json.rows ?? [] };
}
