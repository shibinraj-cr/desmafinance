-- AI analysis fields on OpsDocument: proof files (image/PDF) are run through
-- Claude to assess whether they support the step. All additive + nullable
-- (aiStatus defaults to 'skipped'), so existing rows are unaffected.

-- AlterTable
ALTER TABLE "OpsDocument" ADD COLUMN     "aiAnalyzedAt" TIMESTAMP(3),
ADD COLUMN     "aiConcerns" TEXT,
ADD COLUMN     "aiFacts" JSONB,
ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "aiStatus" TEXT NOT NULL DEFAULT 'skipped',
ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "aiVerdict" TEXT;
