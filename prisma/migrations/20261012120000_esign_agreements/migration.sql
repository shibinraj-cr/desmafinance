-- CreateEnum
CREATE TYPE "EsignFieldType" AS ENUM ('signature', 'initial', 'text', 'textarea', 'checkbox', 'radio', 'selection', 'date', 'name', 'email', 'phone');

-- CreateEnum
CREATE TYPE "EsignRequestStatus" AS ENUM ('draft', 'sent', 'viewed', 'partially_signed', 'signed', 'declined', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "EsignSignerStatus" AS ENUM ('waiting', 'sent', 'viewed', 'signed', 'declined', 'cancelled');

-- CreateEnum
CREATE TYPE "EsignReviewStatus" AS ENUM ('pending', 'approved', 'rejected', 'needs_fix');

-- CreateTable
CREATE TABLE "EsignTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "defaultExpiryDays" INTEGER NOT NULL DEFAULT 14,
    "defaultReminderDays" INTEGER NOT NULL DEFAULT 3,
    "emailSubject" TEXT,
    "emailBody" TEXT,
    "whatsappTemplateName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "clonedFromId" TEXT,
    "currentVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EsignTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "blobPathname" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "numPages" INTEGER NOT NULL,
    "pages" JSONB NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsignTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignTemplateField" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "type" "EsignFieldType" NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Client',
    "page" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "w" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "mergeKey" TEXT,
    "fontSize" INTEGER NOT NULL DEFAULT 11,
    "alignment" TEXT NOT NULL DEFAULT 'left',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EsignTemplateField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leadId" TEXT,
    "templateVersionId" TEXT,
    "status" "EsignRequestStatus" NOT NULL DEFAULT 'draft',
    "mergeData" JSONB NOT NULL DEFAULT '{}',
    "originalPathname" TEXT,
    "originalSha256" TEXT,
    "signedPathname" TEXT,
    "signedSha256" TEXT,
    "certificatePathname" TEXT,
    "expiresAt" TIMESTAMP(3),
    "reminderDays" INTEGER,
    "lastReminderAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "cc" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'desgro',
    "odooId" INTEGER,
    "supersedesId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EsignRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignSigner" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Client',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "signOrder" INTEGER NOT NULL DEFAULT 1,
    "status" "EsignSignerStatus" NOT NULL DEFAULT 'waiting',
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "otpLockedUntil" TIMESTAMP(3),
    "otpChannel" TEXT,
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "odooItemId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsignSigner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignFieldValue" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "signerId" TEXT,
    "fieldId" TEXT,
    "fieldKey" TEXT,
    "fieldType" "EsignFieldType",
    "page" INTEGER,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "w" DOUBLE PRECISION,
    "h" DOUBLE PRECISION,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsignFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignEvent" (
    "id" SERIAL NOT NULL,
    "requestId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "signerId" TEXT,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "prevHash" TEXT,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "failedFiles" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsignImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EsignImportRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "odooId" INTEGER NOT NULL,
    "reference" TEXT,
    "odooState" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signerName" TEXT,
    "signerEmail" TEXT,
    "signerPhone" TEXT,
    "payload" JSONB NOT NULL,
    "files" JSONB NOT NULL DEFAULT '[]',
    "filesVerified" BOOLEAN NOT NULL DEFAULT false,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "matchedLeadId" TEXT,
    "matchCandidates" JSONB NOT NULL DEFAULT '[]',
    "reviewStatus" "EsignReviewStatus" NOT NULL DEFAULT 'pending',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "promotedRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EsignImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EsignTemplate_currentVersionId_key" ON "EsignTemplate"("currentVersionId");

-- CreateIndex
CREATE INDEX "EsignTemplate_category_idx" ON "EsignTemplate"("category");

-- CreateIndex
CREATE INDEX "EsignTemplate_active_idx" ON "EsignTemplate"("active");

-- CreateIndex
CREATE INDEX "EsignTemplateVersion_blobPathname_idx" ON "EsignTemplateVersion"("blobPathname");

-- CreateIndex
CREATE UNIQUE INDEX "EsignTemplateVersion_templateId_version_key" ON "EsignTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EsignTemplateField_versionId_key_key" ON "EsignTemplateField"("versionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "EsignRequest_odooId_key" ON "EsignRequest"("odooId");

-- CreateIndex
CREATE INDEX "EsignRequest_leadId_idx" ON "EsignRequest"("leadId");

-- CreateIndex
CREATE INDEX "EsignRequest_status_idx" ON "EsignRequest"("status");

-- CreateIndex
CREATE INDEX "EsignRequest_templateVersionId_idx" ON "EsignRequest"("templateVersionId");

-- CreateIndex
CREATE INDEX "EsignRequest_createdAt_idx" ON "EsignRequest"("createdAt");

-- CreateIndex
CREATE INDEX "EsignRequest_tags_idx" ON "EsignRequest" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "EsignSigner_tokenHash_key" ON "EsignSigner"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "EsignSigner_odooItemId_key" ON "EsignSigner"("odooItemId");

-- CreateIndex
CREATE INDEX "EsignSigner_requestId_idx" ON "EsignSigner"("requestId");

-- CreateIndex
CREATE INDEX "EsignFieldValue_requestId_idx" ON "EsignFieldValue"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "EsignEvent_requestId_seq_key" ON "EsignEvent"("requestId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "EsignImportBatch_fileName_key" ON "EsignImportBatch"("fileName");

-- CreateIndex
CREATE UNIQUE INDEX "EsignImportRecord_odooId_key" ON "EsignImportRecord"("odooId");

-- CreateIndex
CREATE UNIQUE INDEX "EsignImportRecord_promotedRequestId_key" ON "EsignImportRecord"("promotedRequestId");

-- CreateIndex
CREATE INDEX "EsignImportRecord_reviewStatus_matchStatus_idx" ON "EsignImportRecord"("reviewStatus", "matchStatus");

-- CreateIndex
CREATE INDEX "EsignImportRecord_batchId_idx" ON "EsignImportRecord"("batchId");

-- AddForeignKey
ALTER TABLE "EsignTemplate" ADD CONSTRAINT "EsignTemplate_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "EsignTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignTemplate" ADD CONSTRAINT "EsignTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignTemplateVersion" ADD CONSTRAINT "EsignTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EsignTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignTemplateVersion" ADD CONSTRAINT "EsignTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignTemplateField" ADD CONSTRAINT "EsignTemplateField_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EsignTemplateVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "EsignTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "EsignRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignRequest" ADD CONSTRAINT "EsignRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignSigner" ADD CONSTRAINT "EsignSigner_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EsignRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignFieldValue" ADD CONSTRAINT "EsignFieldValue_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EsignRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignFieldValue" ADD CONSTRAINT "EsignFieldValue_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "EsignSigner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignFieldValue" ADD CONSTRAINT "EsignFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "EsignTemplateField"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignEvent" ADD CONSTRAINT "EsignEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "EsignRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignEvent" ADD CONSTRAINT "EsignEvent_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "EsignSigner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignImportRecord" ADD CONSTRAINT "EsignImportRecord_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EsignImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignImportRecord" ADD CONSTRAINT "EsignImportRecord_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EsignImportRecord" ADD CONSTRAINT "EsignImportRecord_promotedRequestId_fkey" FOREIGN KEY ("promotedRequestId") REFERENCES "EsignRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Audit trail: hash chain + append-only ─────────────────────────────────
--
-- Hand-written; Prisma does not manage functions or triggers, so these never
-- show up as schema drift.
--
-- Every EsignEvent row carries the SHA-256 of its own content plus the hash of
-- the row before it in the same request. The insert trigger assigns `seq`,
-- `createdAt`, `prevHash` and `hash` itself — whatever the caller sends is
-- overwritten — so a row cannot be backdated or slotted into the chain.
--
-- The trigger takes a per-request advisory lock before reading the previous
-- row. Without it, two concurrent inserts could read the same predecessor and
-- fork the chain; ordering by the serial `id` would not help either, because
-- ids are drawn before the lock is taken.
--
-- The hashed payload is a jsonb array, not a delimited string, so no field
-- value can be crafted to collide with another split of the same text.

CREATE FUNCTION esign_event_hash(
  prev_hash  TEXT,
  request_id TEXT,
  seq        INTEGER,
  signer_id  TEXT,
  action     TEXT,
  actor      TEXT,
  ip         TEXT,
  user_agent TEXT,
  meta       JSONB,
  created_at TIMESTAMP(3)
) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    prev_hash, request_id, seq, signer_id, action, actor, ip, user_agent, meta,
    to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )::text, 'UTF8')), 'hex')
$$;

CREATE FUNCTION esign_event_chain() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  last_seq  INTEGER;
  last_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('esign_event:' || NEW."requestId"));

  SELECT e."seq", e."hash" INTO last_seq, last_hash
  FROM "EsignEvent" e
  WHERE e."requestId" = NEW."requestId"
  ORDER BY e."seq" DESC
  LIMIT 1;

  NEW."seq"       := COALESCE(last_seq, 0) + 1;
  NEW."prevHash"  := COALESCE(last_hash, '');
  -- Database clock in UTC, cut to the column's millisecond precision so the
  -- stored value hashes exactly as it did here.
  NEW."createdAt" := date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC');
  NEW."hash"      := esign_event_hash(
    NEW."prevHash", NEW."requestId", NEW."seq", NEW."signerId", NEW."action",
    NEW."actor", NEW."ip", NEW."userAgent", NEW."meta", NEW."createdAt"
  );
  RETURN NEW;
END $$;

CREATE TRIGGER "EsignEvent_chain"
  BEFORE INSERT ON "EsignEvent"
  FOR EACH ROW EXECUTE FUNCTION esign_event_chain();

CREATE FUNCTION esign_event_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EsignEvent is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER "EsignEvent_no_update_delete"
  BEFORE UPDATE OR DELETE ON "EsignEvent"
  FOR EACH ROW EXECUTE FUNCTION esign_event_immutable();

CREATE TRIGGER "EsignEvent_no_truncate"
  BEFORE TRUNCATE ON "EsignEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION esign_event_immutable();

-- Walk a request's chain and recompute every hash. Returns the id of the first
-- row that does not check out (gap in seq, wrong prevHash, or content that no
-- longer matches its hash), or NULL when the whole chain is intact.
CREATE FUNCTION esign_event_chain_break(req TEXT) RETURNS INTEGER LANGUAGE plpgsql STABLE AS $$
DECLARE
  r        RECORD;
  prev     TEXT := '';
  want_seq INTEGER := 1;
BEGIN
  FOR r IN
    SELECT * FROM "EsignEvent" WHERE "requestId" = req ORDER BY "seq"
  LOOP
    IF r."seq" <> want_seq
       OR COALESCE(r."prevHash", '') <> prev
       OR r."hash" IS DISTINCT FROM esign_event_hash(
            prev, r."requestId", r."seq", r."signerId", r."action",
            r."actor", r."ip", r."userAgent", r."meta", r."createdAt")
    THEN
      RETURN r."id";
    END IF;
    prev := r."hash";
    want_seq := want_seq + 1;
  END LOOP;
  RETURN NULL;
END $$;
