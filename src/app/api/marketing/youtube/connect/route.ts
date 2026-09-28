import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { siteBaseUrl } from "@/lib/site-url";
import { YOUTUBE_CALLBACK_PATH, buildAuthUrl, youtubeOAuthConfig } from "@/lib/youtube/google";
import { YOUTUBE_INSIGHTS_HREF, canUseYouTubeInsights } from "@/lib/youtube/insights";

export const dynamic = "force-dynamic";

const YT_STATE_COOKIE = "yt_oauth_state";

/**
 * GET /api/marketing/youtube/connect — starts Google's consent flow. A random
 * `state` goes into a short-lived httpOnly cookie and is checked on the way
 * back, so a forged callback cannot attach someone else's channel.
 */
export async function GET(req: Request) {
  const base = siteBaseUrl(req);
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) return NextResponse.redirect(`${base}/login`);
  if (!canUseYouTubeInsights(perms)) return NextResponse.redirect(`${base}/`);
  if (!youtubeOAuthConfig()) return NextResponse.redirect(`${base}${YOUTUBE_INSIGHTS_HREF}?yt=not_configured`);

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(buildAuthUrl(`${base}${YOUTUBE_CALLBACK_PATH}`, state));
  res.cookies.set(YT_STATE_COOKIE, state, {
    httpOnly: true,
    secure: base.startsWith("https://"),
    sameSite: "lax",
    path: "/api/marketing/youtube",
    maxAge: 600,
  });
  return res;
}
