-- WaBroadcast: media for an image/video/document header template. Campaign-level
-- (same media for every recipient); Meta requires the media on every Cloud-API
-- send of a media-header template. Null for text / header-less templates.
ALTER TABLE "WaBroadcast" ADD COLUMN "headerMediaType" TEXT;
ALTER TABLE "WaBroadcast" ADD COLUMN "headerMediaUrl" TEXT;
