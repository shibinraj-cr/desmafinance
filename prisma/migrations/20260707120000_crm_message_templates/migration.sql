-- CreateTable
CREATE TABLE "CrmMessageTemplate" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmMessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmMessageTemplate_channel_isActive_idx" ON "CrmMessageTemplate"("channel", "isActive");

-- CreateIndex
CREATE INDEX "CrmMessageTemplate_createdById_idx" ON "CrmMessageTemplate"("createdById");

-- AddForeignKey
ALTER TABLE "CrmMessageTemplate" ADD CONSTRAINT "CrmMessageTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: consultant phone for the {consultant_phone} merge field
ALTER TABLE "LeadPulseRole" ADD COLUMN "phone" TEXT;
