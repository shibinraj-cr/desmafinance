-- Executive Meeting Notes — a share can grant edit access (content and action
-- items; never delete or re-share). Additive: one column, default false, so
-- every existing share stays read-only.

-- AlterTable
ALTER TABLE "ExecMeetingShare" ADD COLUMN     "canEdit" BOOLEAN NOT NULL DEFAULT false;
