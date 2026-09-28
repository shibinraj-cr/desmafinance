-- CreateTable
CREATE TABLE "YouTubeConnection" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelTitle" TEXT NOT NULL,
    "uploadsPlaylistId" TEXT,
    "refreshTokenEnc" TEXT NOT NULL,
    "scope" TEXT,
    "connectedById" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncOk" BOOLEAN,
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeVideo" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "publishDay" DATE NOT NULL,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "format" TEXT NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "thumbnailUrl" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeChannelDay" (
    "channelId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "shortsViews" INTEGER NOT NULL DEFAULT 0,
    "videoViews" INTEGER NOT NULL DEFAULT 0,
    "liveViews" INTEGER NOT NULL DEFAULT 0,
    "watchMinutes" INTEGER NOT NULL DEFAULT 0,
    "subscribersGained" INTEGER NOT NULL DEFAULT 0,
    "subscribersLost" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeChannelDay_pkey" PRIMARY KEY ("channelId","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeConnection_channelId_key" ON "YouTubeConnection"("channelId");

-- CreateIndex
CREATE INDEX "YouTubeVideo_channelId_publishDay_idx" ON "YouTubeVideo"("channelId", "publishDay");

-- CreateIndex
CREATE INDEX "YouTubeChannelDay_day_idx" ON "YouTubeChannelDay"("day");

