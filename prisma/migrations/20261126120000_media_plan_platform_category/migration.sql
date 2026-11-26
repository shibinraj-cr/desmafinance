-- Media Planner: every item is one post on one platform, filed under a content
-- category. Existing items get the platform their format implies; long videos
-- and posters get their obvious category, the rest stay uncategorised until
-- someone files them.
ALTER TABLE "MediaPlanItem" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE "MediaPlanItem" ADD COLUMN "category" TEXT;

UPDATE "MediaPlanItem" SET "platform" = 'instagram' WHERE "format" IN ('reel', 'poster');
UPDATE "MediaPlanItem" SET "category" = 'longform' WHERE "format" = 'video';
UPDATE "MediaPlanItem" SET "category" = 'poster' WHERE "format" = 'poster';

CREATE INDEX "MediaPlanItem_platform_publishDate_idx" ON "MediaPlanItem"("platform", "publishDate");
