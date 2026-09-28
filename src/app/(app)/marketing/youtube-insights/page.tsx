import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { addDays, todayIst } from "@/lib/lead-pulse-dates";
import { YOUTUBE_CALLBACK_PATH, youtubeOAuthConfig } from "@/lib/youtube/google";
import { canUseYouTubeInsights, loadInsights } from "@/lib/youtube/insights";
import { YouTubeInsightsClient } from "./client";

export const dynamic = "force-dynamic";

const RANGES = [90, 180, 365, 730] as const;

export default async function YouTubeInsightsPage({
  searchParams,
}: {
  searchParams: { days?: string; yt?: string };
}) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) redirect("/login");
  if (!canUseYouTubeInsights(perms)) redirect("/");

  const requested = Number(searchParams.days);
  const days = (RANGES as readonly number[]).includes(requested) ? requested : 180;
  // End yesterday: YouTube reports lag and today's leads are still arriving.
  const to = addDays(todayIst(), -1);
  const from = addDays(to, -(days - 1));

  const [conn, data] = await Promise.all([
    prisma.youTubeConnection.findFirst({
      orderBy: { createdAt: "desc" },
      select: { channelTitle: true, channelId: true, lastSyncAt: true, lastSyncOk: true, lastSyncError: true },
    }),
    loadInsights(from, to),
  ]);

  // The exact redirect URI to register in Google Cloud, shown in the setup hint.
  const h = headers();
  const base =
    process.env.APP_BASE_URL?.replace(/\/$/, "") ??
    `${(h.get("x-forwarded-proto") ?? "https").split(",")[0]}://${h.get("x-forwarded-host") ?? h.get("host")}`;

  return (
    <YouTubeInsightsClient
      rangeDays={days}
      ranges={[...RANGES]}
      from={from}
      to={to}
      days={data.days}
      videos={data.videos}
      connection={
        conn
          ? {
              channelTitle: conn.channelTitle,
              channelId: conn.channelId,
              lastSyncAt: conn.lastSyncAt ? conn.lastSyncAt.toISOString() : null,
              lastSyncOk: conn.lastSyncOk,
              lastSyncError: conn.lastSyncError,
            }
          : null
      }
      oauthConfigured={youtubeOAuthConfig() !== null}
      redirectUri={`${base}${YOUTUBE_CALLBACK_PATH}`}
      flash={searchParams.yt ?? null}
    />
  );
}
