/**
 * Idempotent: relax NOT NULL on CollectionPlan.{category,subItem,paymentMode}
 * so the new-plan wizard can stage installments without committing to a
 * category / payment mode / EXP-DOM upfront. Those fields get captured
 * later, at the per-installment "Submit to Daily Tracker" step.
 *
 *   npx tsx prisma/migrate-collection-plan-defaults-nullable.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const STEPS: Array<{ label: string; sql: string }> = [
  {
    label: "CollectionPlan.category drop NOT NULL",
    sql: `ALTER TABLE "CollectionPlan" ALTER COLUMN "category" DROP NOT NULL`,
  },
  {
    label: "CollectionPlan.subItem drop NOT NULL",
    sql: `ALTER TABLE "CollectionPlan" ALTER COLUMN "subItem" DROP NOT NULL`,
  },
  {
    label: "CollectionPlan.paymentMode drop NOT NULL",
    sql: `ALTER TABLE "CollectionPlan" ALTER COLUMN "paymentMode" DROP NOT NULL`,
  },
];

async function main() {
  for (const { label, sql } of STEPS) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log(`✓ ${label}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`✗ ${label}: ${msg}`);
      throw e;
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
