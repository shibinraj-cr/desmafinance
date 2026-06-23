-- AlterTable: re-inquiry tracking on Lead. A re-submission by an existing
-- candidate (duplicate by email/phone) is folded onto the canonical lead rather
-- than creating a new row: `inquiryCount` counts total submissions (1 = the
-- original), `lastInquiryAt` stamps the most recent re-inquiry.
ALTER TABLE "Lead" ADD COLUMN "inquiryCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Lead" ADD COLUMN "lastInquiryAt" TIMESTAMP(3);

-- CreateIndex: backs a "recent re-inquiries" sort/filter.
CREATE INDEX "Lead_lastInquiryAt_idx" ON "Lead"("lastInquiryAt");
