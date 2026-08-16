-- Who may send a given approved WhatsApp template.
--
-- Templates live at Meta, so a grant names a template KEY (`name:language`)
-- rather than a row here. Default is DENY: a template with no grants is
-- admin-only, because the point of this table is that consultants do not see the
-- whole catalogue — and "everyone until restricted" would make every newly
-- approved template world-visible the moment Meta approves it.
CREATE TABLE "WaTemplateGrant" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    -- Exactly one of userId / leadPulseRole is set.
    "userId" TEXT,
    "leadPulseRole" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaTemplateGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WaTemplateGrant_templateKey_idx" ON "WaTemplateGrant"("templateKey");
CREATE INDEX "WaTemplateGrant_userId_idx" ON "WaTemplateGrant"("userId");
CREATE INDEX "WaTemplateGrant_leadPulseRole_idx" ON "WaTemplateGrant"("leadPulseRole");

-- Partial uniques rather than one @@unique: a plain composite over nullable
-- columns would not collide, because NULL never equals NULL in Postgres — so
-- the same user could be granted the same template unboundedly.
CREATE UNIQUE INDEX "WaTemplateGrant_template_user_key"
  ON "WaTemplateGrant"("templateKey", "userId") WHERE "userId" IS NOT NULL;
CREATE UNIQUE INDEX "WaTemplateGrant_template_role_key"
  ON "WaTemplateGrant"("templateKey", "leadPulseRole") WHERE "leadPulseRole" IS NOT NULL;

ALTER TABLE "WaTemplateGrant" ADD CONSTRAINT "WaTemplateGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaTemplateGrant" ADD CONSTRAINT "WaTemplateGrant_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
