-- Instagram DMs → CRM leads (src/lib/ig/ingest.ts). Purely additive: two new
-- tables and one source row, nothing existing is altered, so the live
-- deployment keeps serving while this applies.
--
-- IgContact gathers what one Instagram user has told us across their DMs until
-- a phone or an email arrives and a lead can be created (or an existing one
-- linked). IgMessage keeps every message either way, including while lead
-- capture is switched off, so turning it on later loses nothing that was said.

-- CreateTable
CREATE TABLE "IgContact" (
    "id" TEXT NOT NULL,
    "igsid" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "typedName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phoneE164" TEXT,
    "qualificationId" TEXT,
    "qualificationOther" TEXT,
    "leadId" TEXT,
    "linkedAt" TIMESTAMP(3),
    "leadCreated" BOOLEAN NOT NULL DEFAULT false,
    "leadNameSet" TEXT,
    "askCount" INTEGER NOT NULL DEFAULT 0,
    "lastAskAt" TIMESTAMP(3),
    "thankedAt" TIMESTAMP(3),
    "humanRepliedAt" TIMESTAMP(3),
    "autoAskBlocked" TEXT,
    "firstInboundAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IgContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IgMessage" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "sender" TEXT,
    "body" TEXT,
    "quickReplyPayload" TEXT,
    "attachmentType" TEXT,
    "providerMessageId" TEXT,
    "sendStatus" TEXT,
    "sendError" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IgMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IgContact_igsid_key" ON "IgContact"("igsid");

-- CreateIndex
CREATE INDEX "IgContact_leadId_idx" ON "IgContact"("leadId");

-- CreateIndex
CREATE INDEX "IgContact_lastInboundAt_idx" ON "IgContact"("lastInboundAt");

-- CreateIndex
CREATE UNIQUE INDEX "IgMessage_providerMessageId_key" ON "IgMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "IgMessage_contactId_occurredAt_idx" ON "IgMessage"("contactId", "occurredAt");

-- AddForeignKey
ALTER TABLE "IgContact" ADD CONSTRAINT "IgContact_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "CrmQualification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgContact" ADD CONSTRAINT "IgContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IgMessage" ADD CONSTRAINT "IgMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "IgContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The "Insta" source DM-created leads are stamped with, so they are their own
-- bucket in the source funnel rather than folded into "Insta / FB" (which BDEs
-- pick by hand for leads they key in). Guarded on code AND label: if an admin
-- already made an "Insta" source in Master Data, that row is used instead of a
-- second, near-identical one — see resolveInstaSourceId.
INSERT INTO "LeadPulseSource" ("id", "code", "label", "displayOrder", "active", "createdAt", "updatedAt")
SELECT 'lpsrc_insta_dm_seed', 'insta', 'Insta', 11, true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "LeadPulseSource" WHERE "code" = 'insta' OR lower("label") = 'insta'
);
