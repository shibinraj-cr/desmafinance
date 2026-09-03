-- WhatsApp templates authored in the CRM and submitted to Meta for approval.
--
-- Distinct from "CrmMessageTemplate", which is a free-text message with {name}
-- merge fields for the 24-hour session composer and never reaches Meta. This
-- table is the real thing: a template that lives on the WABA, carries {{1}}
-- positional variables, and cannot be sent to a candidate until Meta approves it.
--
-- Meta's catalogue is the source of truth for STATUS. This row exists because
-- the catalogue holds no drafts, no record of who submitted what, and nothing at
-- all once a template is deleted there -- which would otherwise destroy the only
-- copy of wording that took a review cycle to get approved.
CREATE TABLE "WaTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    -- Meta's template id. NULL while still a draft here; the only handle for
    -- editing or deleting the template afterwards.
    "metaId" TEXT,
    -- 'DRAFT' (ours) | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | ...
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    -- Meta's rejection code; the only explanation an author gets.
    "rejectedReason" TEXT,
    -- A payload Meta would not even accept for review, as distinct from one it
    -- reviewed and refused.
    "lastError" TEXT,
    -- Header / body / footer / buttons and their sample values, stored whole
    -- because that is how they are submitted.
    "spec" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaTemplate_pkey" PRIMARY KEY ("id")
);

-- One name per language, not one name globally: the same template legitimately
-- exists in several languages and Meta treats each as a separate template.
CREATE UNIQUE INDEX "WaTemplate_name_language_key" ON "WaTemplate"("name", "language");
CREATE UNIQUE INDEX "WaTemplate_metaId_key" ON "WaTemplate"("metaId");
CREATE INDEX "WaTemplate_status_idx" ON "WaTemplate"("status");
CREATE INDEX "WaTemplate_createdById_idx" ON "WaTemplate"("createdById");

ALTER TABLE "WaTemplate" ADD CONSTRAINT "WaTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
