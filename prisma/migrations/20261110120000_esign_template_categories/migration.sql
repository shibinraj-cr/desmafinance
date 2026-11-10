-- CreateTable
CREATE TABLE "EsignTemplateCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EsignTemplateCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EsignTemplateCategory_name_key" ON "EsignTemplateCategory"("name");

-- CreateIndex
CREATE INDEX "EsignTemplateCategory_sortOrder_idx" ON "EsignTemplateCategory"("sortOrder");


-- The categories that were fixed in code (TEMPLATE_CATEGORIES), in the same
-- order, so the pickers look exactly as before this ships. Fixed ids keep a
-- re-run of this statement harmless.
INSERT INTO "EsignTemplateCategory" ("id", "name", "sortOrder", "updatedAt") VALUES
    ('esign-cat-ahpra-agreement', 'AHPRA Agreement', 0, CURRENT_TIMESTAMP),
    ('esign-cat-ahpra-pathway', 'AHPRA Pathway', 1, CURRENT_TIMESTAMP),
    ('esign-cat-visa-agreement-aus', 'Visa Agreement (AUS)', 2, CURRENT_TIMESTAMP),
    ('esign-cat-nz-agreement', 'NZ Agreement', 3, CURRENT_TIMESTAMP),
    ('esign-cat-nclex-rn-booking', 'NCLEX RN Booking', 4, CURRENT_TIMESTAMP),
    ('esign-cat-sales', 'Sales', 5, CURRENT_TIMESTAMP),
    ('esign-cat-agent', 'Agent', 6, CURRENT_TIMESTAMP),
    ('esign-cat-promotional', 'Promotional', 7, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- Any other category a template already carries, so every template's category
-- has a row to rename or archive. None is expected: the API only accepted the
-- list above.
INSERT INTO "EsignTemplateCategory" ("id", "name", "sortOrder", "updatedAt")
SELECT 'esign-cat-' || md5(t."category"), t."category", 100, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "category" FROM "EsignTemplate") t
ON CONFLICT ("name") DO NOTHING;
