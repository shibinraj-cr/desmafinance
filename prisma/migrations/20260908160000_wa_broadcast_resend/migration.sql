-- WaBroadcast: re-send provenance. When resendOfId is set, the campaign's
-- audience is seeded from the recipients of that source broadcast whose delivery
-- outcome matched resendScope (not a lead segment). Plain columns, no FK.
ALTER TABLE "WaBroadcast" ADD COLUMN "resendOfId" TEXT;
ALTER TABLE "WaBroadcast" ADD COLUMN "resendScope" TEXT;
