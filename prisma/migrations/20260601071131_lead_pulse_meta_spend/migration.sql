-- CreateTable
CREATE TABLE "LeadPulseMetaSpend" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadPulseMetaSpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadPulseMetaSpend_year_month_idx" ON "LeadPulseMetaSpend"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "LeadPulseMetaSpend_year_month_key" ON "LeadPulseMetaSpend"("year", "month");

-- AddForeignKey
ALTER TABLE "LeadPulseMetaSpend" ADD CONSTRAINT "LeadPulseMetaSpend_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
