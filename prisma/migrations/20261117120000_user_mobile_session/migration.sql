-- One signed-in phone per user for the mobile app (src/lib/mobile-session.ts).
-- Additive and nullable: tokens issued before this keep working until the
-- user's next app sign-in.
ALTER TABLE "User" ADD COLUMN "mobileSessionId" TEXT,
ADD COLUMN "mobileSessionAt" TIMESTAMP(3),
ADD COLUMN "mobileSessionDevice" TEXT;
