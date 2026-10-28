-- Broadcast control group: share of the audience held back, never sent.
-- Additive with a default; existing campaigns are 0 (no holdout).
ALTER TABLE "WaBroadcast" ADD COLUMN "holdoutPct" INTEGER NOT NULL DEFAULT 0;
