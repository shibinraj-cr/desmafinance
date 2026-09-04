-- News & Updates: a read-only broadcast feed every signed-in user can see.
--
-- Three tables and a read receipt. A NewsTopic is a subject area ("Australia
-- Immigration", "AHPRA"); a NewsSource is one link the daily cron polls, pinned
-- to exactly one topic; a NewsItem is one update, carrying its source's topic.
-- That is what makes the feed topic-wise: the topic is a property of the link,
-- so it does not have to be decided per item.
--
-- Read state is the absence of a NewsItemRead row rather than a flag on the
-- item, because an item is broadcast to everyone but read by one person at a
-- time -- and it is the per-user unread count that drives the nav badge.

CREATE TABLE "NewsTopic" (
    "id" TEXT NOT NULL,
    -- URL-safe key used in the ?topic= filter; stable across renames.
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    -- Material Symbols icon name, shown on the topic chip.
    "icon" TEXT NOT NULL DEFAULT 'newspaper',
    -- Accent key ('blue', 'green', ...) resolved to classes in the UI.
    "color" TEXT NOT NULL DEFAULT 'blue',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    -- Deactivating stops the fetch and hides the topic; it keeps the items.
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsSource" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    -- 'rss'  -- RSS 2.0 / Atom feed; every entry becomes an item.
    -- 'page' -- plain HTML page; a change in its text files one "updated" item.
    "kind" TEXT NOT NULL DEFAULT 'rss',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    -- 'ok' | 'error' | 'empty'; never null after the first run.
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastItemCount" INTEGER NOT NULL DEFAULT 0,
    -- Hash of the last successful read. The change detector for 'page' sources,
    -- and a reparse short-circuit for 'rss' ones.
    "contentHash" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    -- NULL for an admin's hand-written post, which has no upstream link.
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    -- Plain text: feed HTML is stripped before storing, so nothing from a feed
    -- is ever rendered as markup.
    "summary" TEXT,
    "url" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    -- Stable per-source identity so a re-run does not re-file the same entry:
    -- the feed's guid/id, else the entry link, else a hash of the title.
    "guid" TEXT NOT NULL,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsItemRead" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsItemRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NewsTopic_slug_key" ON "NewsTopic"("slug");
CREATE INDEX "NewsTopic_isActive_sortOrder_idx" ON "NewsTopic"("isActive", "sortOrder");
CREATE INDEX "NewsTopic_createdById_idx" ON "NewsTopic"("createdById");

CREATE UNIQUE INDEX "NewsSource_url_key" ON "NewsSource"("url");
CREATE INDEX "NewsSource_topicId_isActive_idx" ON "NewsSource"("topicId", "isActive");
CREATE INDEX "NewsSource_createdById_idx" ON "NewsSource"("createdById");

-- Two sources may legitimately carry the same article, so dedupe is per source.
CREATE UNIQUE INDEX "NewsItem_sourceId_guid_key" ON "NewsItem"("sourceId", "guid");
CREATE INDEX "NewsItem_topicId_publishedAt_idx" ON "NewsItem"("topicId", "publishedAt");
-- Backs the unread-count query, which is windowed on publishedAt across topics.
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");
CREATE INDEX "NewsItem_createdById_idx" ON "NewsItem"("createdById");

CREATE UNIQUE INDEX "NewsItemRead_itemId_userId_key" ON "NewsItemRead"("itemId", "userId");
CREATE INDEX "NewsItemRead_userId_idx" ON "NewsItemRead"("userId");

ALTER TABLE "NewsTopic" ADD CONSTRAINT "NewsTopic_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NewsSource" ADD CONSTRAINT "NewsSource_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "NewsTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsSource" ADD CONSTRAINT "NewsSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "NewsTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A deleted source leaves its items in the feed rather than erasing history.
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NewsItemRead" ADD CONSTRAINT "NewsItemRead_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "NewsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsItemRead" ADD CONSTRAINT "NewsItemRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
