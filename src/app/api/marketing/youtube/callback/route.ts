import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { siteBaseUrl } from "@/lib/site-url";
import { YOUTUBE_CALLBACK_PATH, exchangeCode, fetchMyChannel, revokeToken } from "@/lib/youtube/google";
import { decryptToken, encryptToken } from "@/lib/youtube/token-crypto";
import { YOUTUBE_INSIGHTS_HREF, canUseYouTubeInsights, syncYouTube } from "@/lib/youtube/insights";

export const dynamic = "force-dynamic";
// The first sync (every upload + two years of daily analytics) runs inline.
export const maxDuration = 300;

const STATE_COOKIE = "yt_oauth_state";

/**
 * GET /api/marketing/youtube/callback — Google redirects here after consent.
 * Stores the (encrypted) refresh token for the chosen channel, replacing any
 * previously connected channel, then runs the first full sync.
 */
export async function GET(req: Request) {
  const base = siteBaseUrl(req);
  const page = `${base}${YOUTUBE_INSIGHTS_HREF}`;
  const back = (status: string) => {
    const res = NextResponse.redirect(`${page}?yt=${encodeURIComponent(status)}`);
    res.cookies.set(STATE_COOKIE, "", { path: "/api/marketing/youtube", maxAge: 0 });
    return res;
  };

  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.redirect(`${base}/login`);
  if (!canUseYouTubeInsights(perms)) return NextResponse.redirect(`${base}/`);

  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookies().get(STATE_COOKIE)?.value;
  if (!code || !state || !expected || state !== expected) return back("bad_state");

  let refreshToken: string;
  let scope: string | null;
  let channel;
  try {
    const tokens = await exchangeCode(code, `${base}${YOUTUBE_CALLBACK_PATH}`);
    if (!tokens.refresh_token) return back("no_refresh_token");
    refreshToken = tokens.refresh_token;
    scope = tokens.scope ?? null;
    channel = await fetchMyChannel(tokens.access_token);
  } catch (e) {
    console.error("[youtube] OAuth exchange failed:", e);
    return back("exchange_failed");
  }
  if (!channel) {
    await revokeToken(refreshToken);
    return back("no_channel");
  }

  // One channel at a time: drop (and revoke) any other connection first.
  const others = await prisma.youTubeConnection.findMany({ where: { channelId: { not: channel.id } } });
  for (const o of others) {
    try {
      await revokeToken(decryptToken(o.refreshTokenEnc));
    } catch {
      // Undecryptable old token — nothing to revoke.
    }
  }
  if (others.length) await prisma.youTubeConnection.deleteMany({ where: { id: { in: others.map((o) => o.id) } } });

  const data = {
    channelTitle: channel.title,
    uploadsPlaylistId: channel.uploadsPlaylistId,
    refreshTokenEnc: encryptToken(refreshToken),
    scope,
    connectedById: userId,
    lastSyncError: null,
  };
  const conn = await prisma.youTubeConnection.upsert({
    where: { channelId: channel.id },
    create: { channelId: channel.id, ...data },
    update: data,
  });
  await recordAudit({
    entityType: "YouTubeConnection",
    entityId: conn.id,
    action: "CREATE",
    userId,
    changes: { channelId: channel.id, channelTitle: channel.title },
  });

  try {
    await syncYouTube({ full: true });
    return back("connected");
  } catch (e) {
    console.error("[youtube] first sync failed:", e);
    return back("connected_sync_failed");
  }
}
