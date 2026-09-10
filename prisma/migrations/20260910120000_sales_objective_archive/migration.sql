-- Sales Objective archive.
--
-- Monthly collection as recorded in the DESMA sales-objective workbook, for the
-- months that predate the finance ledger (and, from the ledger's first month on,
-- as the reconciliation reference the ledger is checked against).
--
-- This lives in the database rather than in source because the repo is public
-- and these are the company's actual monthly collections. Populate it with
-- prisma/seed-sales-objective-archive.ts, pointed at the workbook.
CREATE TABLE "SalesObjectiveArchive" (
    "monthKey" TEXT NOT NULL,
    "collected" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesObjectiveArchive_pkey" PRIMARY KEY ("monthKey")
);
