/**
 * One-shot DDL migration: adds CollectionPlan, CollectionPlanInstallment,
 * and PendingApproval.collectionInstallmentId to the live database.
 *
 * Run with:  npx tsx prisma/migrate-collection-plan.ts
 *
 * Idempotent — safe to re-run. Mirrors the additive DDL inlined in
 * /api/master/parties-schema-sync so we keep one source of truth.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STEPS: Array<{ label: string; sql: string }> = [
  {
    label: "CollectionPlan table",
    sql: `CREATE TABLE IF NOT EXISTS "CollectionPlan" (
       "id" TEXT NOT NULL,
       "partyId" TEXT NOT NULL,
       "serviceId" TEXT,
       "label" TEXT NOT NULL,
       "category" TEXT NOT NULL,
       "subItem" TEXT NOT NULL,
       "paymentMode" TEXT NOT NULL,
       "expDom" TEXT DEFAULT 'DOM',
       "notes" TEXT,
       "status" TEXT NOT NULL DEFAULT 'active',
       "createdById" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "CollectionPlan_pkey" PRIMARY KEY ("id")
     )`,
  },
  {
    label: "CollectionPlan partyId index",
    sql: `CREATE INDEX IF NOT EXISTS "CollectionPlan_partyId_idx" ON "CollectionPlan"("partyId")`,
  },
  {
    label: "CollectionPlan serviceId index",
    sql: `CREATE INDEX IF NOT EXISTS "CollectionPlan_serviceId_idx" ON "CollectionPlan"("serviceId")`,
  },
  {
    label: "CollectionPlan status index",
    sql: `CREATE INDEX IF NOT EXISTS "CollectionPlan_status_idx" ON "CollectionPlan"("status")`,
  },
  {
    label: "CollectionPlan createdById index",
    sql: `CREATE INDEX IF NOT EXISTS "CollectionPlan_createdById_idx" ON "CollectionPlan"("createdById")`,
  },
  {
    label: "CollectionPlan.partyId FK",
    sql: `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CollectionPlan_partyId_fkey') THEN
         ALTER TABLE "CollectionPlan"
           ADD CONSTRAINT "CollectionPlan_partyId_fkey"
           FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE;
       END IF;
     END $$`,
  },
  {
    label: "CollectionPlan.serviceId FK",
    sql: `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CollectionPlan_serviceId_fkey') THEN
         ALTER TABLE "CollectionPlan"
           ADD CONSTRAINT "CollectionPlan_serviceId_fkey"
           FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL;
       END IF;
     END $$`,
  },
  {
    label: "CollectionPlan.createdById FK",
    sql: `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CollectionPlan_createdById_fkey') THEN
         ALTER TABLE "CollectionPlan"
           ADD CONSTRAINT "CollectionPlan_createdById_fkey"
           FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL;
       END IF;
     END $$`,
  },
  {
    label: "CollectionPlanInstallment table",
    sql: `CREATE TABLE IF NOT EXISTS "CollectionPlanInstallment" (
       "id" TEXT NOT NULL,
       "planId" TEXT NOT NULL,
       "seq" INTEGER NOT NULL,
       "expectedDate" DATE NOT NULL,
       "amount" DECIMAL(14,2) NOT NULL,
       "category" TEXT,
       "subItem" TEXT,
       "paymentMode" TEXT,
       "description" TEXT,
       "status" TEXT NOT NULL DEFAULT 'pending',
       "pendingApprovalId" TEXT,
       "transactionId" TEXT,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       CONSTRAINT "CollectionPlanInstallment_pkey" PRIMARY KEY ("id")
     )`,
  },
  {
    label: "CollectionPlanInstallment unique (planId, seq)",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "CollectionPlanInstallment_planId_seq_key" ON "CollectionPlanInstallment"("planId", "seq")`,
  },
  {
    label: "CollectionPlanInstallment pendingApprovalId unique",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "CollectionPlanInstallment_pendingApprovalId_key" ON "CollectionPlanInstallment"("pendingApprovalId")`,
  },
  {
    label: "CollectionPlanInstallment transactionId unique",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "CollectionPlanInstallment_transactionId_key" ON "CollectionPlanInstallment"("transactionId")`,
  },
  {
    label: "CollectionPlanInstallment planId index",
    sql: `CREATE INDEX IF NOT EXISTS "CollectionPlanInstallment_planId_idx" ON "CollectionPlanInstallment"("planId")`,
  },
  {
    label: "CollectionPlanInstallment status index",
    sql: `CREATE INDEX IF NOT EXISTS "CollectionPlanInstallment_status_idx" ON "CollectionPlanInstallment"("status")`,
  },
  {
    label: "CollectionPlanInstallment expectedDate index",
    sql: `CREATE INDEX IF NOT EXISTS "CollectionPlanInstallment_expectedDate_idx" ON "CollectionPlanInstallment"("expectedDate")`,
  },
  {
    label: "CollectionPlanInstallment.planId FK",
    sql: `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CollectionPlanInstallment_planId_fkey') THEN
         ALTER TABLE "CollectionPlanInstallment"
           ADD CONSTRAINT "CollectionPlanInstallment_planId_fkey"
           FOREIGN KEY ("planId") REFERENCES "CollectionPlan"("id") ON DELETE CASCADE;
       END IF;
     END $$`,
  },
  {
    label: "CollectionPlanInstallment.transactionId FK",
    sql: `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CollectionPlanInstallment_transactionId_fkey') THEN
         ALTER TABLE "CollectionPlanInstallment"
           ADD CONSTRAINT "CollectionPlanInstallment_transactionId_fkey"
           FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL;
       END IF;
     END $$`,
  },
  {
    label: "PendingApproval.collectionInstallmentId column",
    sql: `ALTER TABLE "PendingApproval" ADD COLUMN IF NOT EXISTS "collectionInstallmentId" TEXT`,
  },
  {
    label: "PendingApproval.collectionInstallmentId unique",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "PendingApproval_collectionInstallmentId_key" ON "PendingApproval"("collectionInstallmentId")`,
  },
  {
    label: "PendingApproval.collectionInstallmentId FK",
    sql: `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PendingApproval_collectionInstallmentId_fkey') THEN
         ALTER TABLE "PendingApproval"
           ADD CONSTRAINT "PendingApproval_collectionInstallmentId_fkey"
           FOREIGN KEY ("collectionInstallmentId") REFERENCES "CollectionPlanInstallment"("id") ON DELETE SET NULL;
       END IF;
     END $$`,
  },
];

async function main() {
  for (const { label, sql } of STEPS) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log(`✓ ${label}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already exists|duplicate/i.test(msg)) {
        console.log(`= ${label} (already in place)`);
      } else {
        console.error(`✗ ${label}: ${msg}`);
        throw e;
      }
    }
  }
  console.log("done");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
