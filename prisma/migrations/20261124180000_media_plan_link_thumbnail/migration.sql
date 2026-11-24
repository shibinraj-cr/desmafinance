-- Media Planner: a post link and an uploaded cover thumbnail per item. Additive only.
ALTER TABLE "MediaPlanItem" ADD COLUMN "link" TEXT;
ALTER TABLE "MediaPlanItem" ADD COLUMN "thumbnailPath" TEXT;
ALTER TABLE "MediaPlanItem" ADD COLUMN "thumbnailUpdatedAt" TIMESTAMP(3);
