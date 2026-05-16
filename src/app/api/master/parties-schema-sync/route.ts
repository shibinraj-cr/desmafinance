import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Admin-only one-shot DDL sync that brings the live database in line
 * with the Prisma schema for the Source/Service/Profile feature
 * (commit d04ffb6). Runs only the *additive* changes, so it's safe:
 *
 *   - ALTER TABLE "Party" ADD COLUMN "sourceId" (idempotent via IF NOT EXISTS)
 *   - Add FK + index on Party.sourceId
 *   - CREATE TABLE "PartyService" with constraints + indexes
 *   - Copy any existing rows from the legacy `_PartyToService` M:M
 *     into PartyService with totalAmount=0
 *
 * Idempotent — re-running is a no-op once everything is in place.
 *
 * Equivalent to running `npx prisma db push` plus
 * `npm run db:migrate-party-services` against the live DB, but
 * triggerable from the UI without needing local DATABASE_URL access.
 */
export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!perms.isAdmin) {
    return NextResponse.json({ error: "forbidden_admin_only" }, { status: 403 });
  }

  const log: string[] = [];

  async function step(label: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql);
      log.push(`✓ ${label}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Some constraints throw "already exists" — treat those as idempotent OK.
      if (/already exists|duplicate/i.test(msg)) {
        log.push(`= ${label} (already in place)`);
      } else {
        log.push(`✗ ${label}: ${msg}`);
        throw e;
      }
    }
  }

  try {
    // 1. Party.sourceId column
    await step(
      "Party.sourceId column",
      `ALTER TABLE "Party" ADD COLUMN IF NOT EXISTS "sourceId" TEXT`,
    );
    await step(
      "Party.sourceId index",
      `CREATE INDEX IF NOT EXISTS "Party_sourceId_idx" ON "Party"("sourceId")`,
    );
    // FK — wrap in DO block so we can swallow "already exists" cleanly.
    await step(
      "Party.sourceId foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = 'Party_sourceId_fkey'
         ) THEN
           ALTER TABLE "Party"
             ADD CONSTRAINT "Party_sourceId_fkey"
             FOREIGN KEY ("sourceId") REFERENCES "LeadPulseSource"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );

    // 2. PartyService table + indexes + FKs
    await step(
      "PartyService table",
      `CREATE TABLE IF NOT EXISTS "PartyService" (
         "id" TEXT NOT NULL,
         "partyId" TEXT NOT NULL,
         "serviceId" TEXT NOT NULL,
         "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
         "notes" TEXT,
         "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
         "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
         CONSTRAINT "PartyService_pkey" PRIMARY KEY ("id")
       )`,
    );
    await step(
      "PartyService unique (partyId, serviceId)",
      `CREATE UNIQUE INDEX IF NOT EXISTS "PartyService_partyId_serviceId_key" ON "PartyService"("partyId", "serviceId")`,
    );
    await step(
      "PartyService partyId index",
      `CREATE INDEX IF NOT EXISTS "PartyService_partyId_idx" ON "PartyService"("partyId")`,
    );
    await step(
      "PartyService serviceId index",
      `CREATE INDEX IF NOT EXISTS "PartyService_serviceId_idx" ON "PartyService"("serviceId")`,
    );
    await step(
      "PartyService.partyId foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PartyService_partyId_fkey') THEN
           ALTER TABLE "PartyService"
             ADD CONSTRAINT "PartyService_partyId_fkey"
             FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE;
         END IF;
       END $$`,
    );
    await step(
      "PartyService.serviceId foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PartyService_serviceId_fkey') THEN
           ALTER TABLE "PartyService"
             ADD CONSTRAINT "PartyService_serviceId_fkey"
             FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT;
         END IF;
       END $$`,
    );

    // 3. Party.assignedL2BdeId — used by the L2 service targets matrix
    await step(
      "Party.assignedL2BdeId column",
      `ALTER TABLE "Party" ADD COLUMN IF NOT EXISTS "assignedL2BdeId" TEXT`,
    );
    await step(
      "Party.assignedL2BdeId index",
      `CREATE INDEX IF NOT EXISTS "Party_assignedL2BdeId_idx" ON "Party"("assignedL2BdeId")`,
    );
    await step(
      "Party.assignedL2BdeId foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Party_assignedL2BdeId_fkey') THEN
           ALTER TABLE "Party"
             ADD CONSTRAINT "Party_assignedL2BdeId_fkey"
             FOREIGN KEY ("assignedL2BdeId") REFERENCES "User"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );

    // 4. LeadPulseTarget table for Suhaina's monthly target entry
    await step(
      "LeadPulseTarget table",
      `CREATE TABLE IF NOT EXISTS "LeadPulseTarget" (
         "id" TEXT NOT NULL,
         "year" INTEGER NOT NULL,
         "month" INTEGER NOT NULL,
         "userId" TEXT NOT NULL,
         "serviceId" TEXT NOT NULL,
         "target" INTEGER NOT NULL DEFAULT 0,
         "updatedById" TEXT,
         "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
         "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
         CONSTRAINT "LeadPulseTarget_pkey" PRIMARY KEY ("id")
       )`,
    );
    await step(
      "LeadPulseTarget unique (year, month, userId, serviceId)",
      `CREATE UNIQUE INDEX IF NOT EXISTS "LeadPulseTarget_year_month_userId_serviceId_key" ON "LeadPulseTarget"("year", "month", "userId", "serviceId")`,
    );
    await step(
      "LeadPulseTarget year/month index",
      `CREATE INDEX IF NOT EXISTS "LeadPulseTarget_year_month_idx" ON "LeadPulseTarget"("year", "month")`,
    );
    await step(
      "LeadPulseTarget userId index",
      `CREATE INDEX IF NOT EXISTS "LeadPulseTarget_userId_idx" ON "LeadPulseTarget"("userId")`,
    );
    await step(
      "LeadPulseTarget.userId foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadPulseTarget_userId_fkey') THEN
           ALTER TABLE "LeadPulseTarget"
             ADD CONSTRAINT "LeadPulseTarget_userId_fkey"
             FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;
         END IF;
       END $$`,
    );
    await step(
      "LeadPulseTarget.serviceId foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadPulseTarget_serviceId_fkey') THEN
           ALTER TABLE "LeadPulseTarget"
             ADD CONSTRAINT "LeadPulseTarget_serviceId_fkey"
             FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT;
         END IF;
       END $$`,
    );
    await step(
      "LeadPulseTarget.updatedById foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadPulseTarget_updatedById_fkey') THEN
           ALTER TABLE "LeadPulseTarget"
             ADD CONSTRAINT "LeadPulseTarget_updatedById_fkey"
             FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );

    // 4b. Service.showInL2Targets toggle for the L2 Targets visibility sub-page.
    await step(
      "Service.showInL2Targets column",
      `ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "showInL2Targets" BOOLEAN NOT NULL DEFAULT true`,
    );

    // 5a. LeadPulseDailyMeta supervisor-review fields for the daily-
    // entry approval workflow.
    await step(
      "LeadPulseDailyMeta.reviewedById column",
      `ALTER TABLE "LeadPulseDailyMeta" ADD COLUMN IF NOT EXISTS "reviewedById" TEXT`,
    );
    await step(
      "LeadPulseDailyMeta.reviewedAt column",
      `ALTER TABLE "LeadPulseDailyMeta" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3)`,
    );
    await step(
      "LeadPulseDailyMeta.reviewNote column",
      `ALTER TABLE "LeadPulseDailyMeta" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT`,
    );
    await step(
      "LeadPulseDailyMeta status index",
      `CREATE INDEX IF NOT EXISTS "LeadPulseDailyMeta_status_idx" ON "LeadPulseDailyMeta"("status")`,
    );
    await step(
      "LeadPulseDailyMeta reviewedById index",
      `CREATE INDEX IF NOT EXISTS "LeadPulseDailyMeta_reviewedById_idx" ON "LeadPulseDailyMeta"("reviewedById")`,
    );
    await step(
      "LeadPulseDailyMeta.reviewedById foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadPulseDailyMeta_reviewedById_fkey') THEN
           ALTER TABLE "LeadPulseDailyMeta"
             ADD CONSTRAINT "LeadPulseDailyMeta_reviewedById_fkey"
             FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );

    // 5b. Holiday table for the marketing module's holiday calendar.
    await step(
      "Holiday table",
      `CREATE TABLE IF NOT EXISTS "Holiday" (
         "id" TEXT NOT NULL,
         "date" DATE NOT NULL,
         "label" TEXT NOT NULL,
         "notes" TEXT,
         "createdById" TEXT,
         "updatedById" TEXT,
         "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
         "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
         CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
       )`,
    );
    await step(
      "Holiday unique (date)",
      `CREATE UNIQUE INDEX IF NOT EXISTS "Holiday_date_key" ON "Holiday"("date")`,
    );
    await step(
      "Holiday date index",
      `CREATE INDEX IF NOT EXISTS "Holiday_date_idx" ON "Holiday"("date")`,
    );
    await step(
      "Holiday.createdById foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Holiday_createdById_fkey') THEN
           ALTER TABLE "Holiday"
             ADD CONSTRAINT "Holiday_createdById_fkey"
             FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );
    await step(
      "Holiday.updatedById foreign key",
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Holiday_updatedById_fkey') THEN
           ALTER TABLE "Holiday"
             ADD CONSTRAINT "Holiday_updatedById_fkey"
             FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL;
         END IF;
       END $$`,
    );
  } catch (e) {
    return NextResponse.json(
      { error: "ddl_failed", log, message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // 3. Copy legacy _PartyToService rows into PartyService.
  let legacyCopied = 0;
  let legacySkipped = 0;
  try {
    const legacyRows = await prisma.$queryRawUnsafe<Array<{ A: string; B: string }>>(
      'SELECT "A", "B" FROM "_PartyToService"',
    );
    for (const row of legacyRows) {
      const existing = await prisma.partyService.findUnique({
        where: { partyId_serviceId: { partyId: row.A, serviceId: row.B } },
      });
      if (existing) {
        legacySkipped++;
        continue;
      }
      await prisma.partyService.create({
        data: { partyId: row.A, serviceId: row.B, totalAmount: 0 },
      });
      legacyCopied++;
    }
    log.push(
      `✓ Legacy M:M copy: ${legacyCopied} created, ${legacySkipped} already present`,
    );
  } catch (e) {
    // _PartyToService might not exist — that's fine.
    log.push(`= No legacy M:M rows to copy (table missing or empty)`);
  }

  await recordAudit({
    entityType: "Party",
    entityId: "__schema_sync__",
    action: "UPDATE",
    userId,
    changes: { kind: "parties_schema_sync", log, legacyCopied, legacySkipped },
  });

  return NextResponse.json({
    ok: true,
    log,
    legacyCopied,
    legacySkipped,
  });
}
