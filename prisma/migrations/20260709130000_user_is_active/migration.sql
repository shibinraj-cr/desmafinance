-- AlterTable: soft-disable flag for users. An inactive user keeps ALL their
-- data but cannot sign in and loses access on their next request. Defaulting to
-- true keeps every existing user active. Adding a column with a constant default
-- is a metadata-only change on Postgres, so this is safe on a live table.
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
