/**
 * One-off migration that:
 *  1. Strips ` (Sales)` / ` (Collection)` suffixes from SubCategory.name,
 *     Transaction.subItem (incl. soft-deleted), and PendingApproval.proposed.
 *  2. Materialises a Service master from the distinct stripped names of
 *     sub-items under the four eligible categories.
 *  3. Links each migrated SubCategory to its Service via SubCategory.serviceId.
 *
 * Idempotent — safe to re-run. Use:
 *   npm run db:migrate-services
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ELIGIBLE_CATEGORIES = [
  "Sales - Nursing Registrations",
  "Collection - Nursing Registrations",
  "Sales - Study Abroad",
  "Collection - Study Abroad",
];

function stripSuffix(s: string): { stripped: string; changed: boolean } {
  const m = s.match(/^(.*?)\s*\((Sales|Collection)\)\s*$/);
  if (!m) return { stripped: s, changed: false };
  return { stripped: m[1].trim(), changed: true };
}

async function main() {
  console.log("Step 1: Rename SubCategory rows…");
  const allSubs = await prisma.subCategory.findMany({
    include: { category: true },
  });
  let renamedSubs = 0;
  let skippedSubs = 0;
  for (const s of allSubs) {
    const { stripped, changed } = stripSuffix(s.name);
    if (!changed || stripped === s.name) continue;
    // Collision check: another sub-item under the same category already
    // having the stripped name.
    const collision = await prisma.subCategory.findUnique({
      where: { categoryId_name: { categoryId: s.categoryId, name: stripped } },
    });
    if (collision && collision.id !== s.id) {
      console.warn(
        `  ⚠ skip ${s.name} (under ${s.category.name}): collision with existing "${stripped}"`,
      );
      skippedSubs++;
      continue;
    }
    await prisma.subCategory.update({ where: { id: s.id }, data: { name: stripped } });
    console.log(`  ✓ ${s.category.name} :: ${s.name} → ${stripped}`);
    renamedSubs++;
  }
  console.log(`  Renamed: ${renamedSubs}, Skipped (collision): ${skippedSubs}`);

  console.log("\nStep 2: Strip Transaction.subItem suffixes…");
  // Use raw SQL for both perf and to update soft-deleted rows in one shot.
  const salesUpdated = await prisma.$executeRawUnsafe(
    `UPDATE "Transaction" SET "subItem" = trim(regexp_replace("subItem", '\\s*\\(Sales\\)\\s*$', '')) WHERE "subItem" ~ '\\(Sales\\)\\s*$'`,
  );
  const collectionUpdated = await prisma.$executeRawUnsafe(
    `UPDATE "Transaction" SET "subItem" = trim(regexp_replace("subItem", '\\s*\\(Collection\\)\\s*$', '')) WHERE "subItem" ~ '\\(Collection\\)\\s*$'`,
  );
  console.log(`  ✓ Stripped (Sales) from ${salesUpdated} transactions`);
  console.log(`  ✓ Stripped (Collection) from ${collectionUpdated} transactions`);

  console.log("\nStep 3: Strip PendingApproval.proposed.subItem suffixes…");
  const pendings = await prisma.pendingApproval.findMany({
    where: { status: "pending" },
  });
  let pendingsTouched = 0;
  for (const p of pendings) {
    if (!p.proposed) continue;
    const proposed = p.proposed as Record<string, unknown>;
    const sub = proposed.subItem;
    if (typeof sub !== "string") continue;
    const { stripped, changed } = stripSuffix(sub);
    if (!changed) continue;
    proposed.subItem = stripped;
    await prisma.pendingApproval.update({
      where: { id: p.id },
      data: { proposed: proposed as object },
    });
    pendingsTouched++;
  }
  console.log(`  ✓ ${pendingsTouched} pending approvals updated`);

  console.log("\nStep 4: Materialise Service master from eligible sub-items…");
  const eligibleSubs = await prisma.subCategory.findMany({
    where: { category: { name: { in: ELIGIBLE_CATEGORIES } } },
    include: { category: true },
  });
  const distinctNames = Array.from(
    new Set(eligibleSubs.map((s) => s.name.trim())),
  ).sort();
  console.log(`  Found ${distinctNames.length} distinct service names`);

  const serviceByName = new Map<string, { id: string; isNew: boolean }>();
  for (const name of distinctNames) {
    const existing = await prisma.service.findUnique({ where: { name } });
    if (existing) {
      serviceByName.set(name, { id: existing.id, isNew: false });
    } else {
      const created = await prisma.service.create({
        data: { name, isActive: true, isSystem: false },
      });
      serviceByName.set(name, { id: created.id, isNew: true });
    }
  }
  const newCount = Array.from(serviceByName.values()).filter((v) => v.isNew).length;
  console.log(`  ✓ ${newCount} new services created (others already existed)`);

  console.log("\nStep 5: Link sub-items to services…");
  let linked = 0;
  for (const s of eligibleSubs) {
    const target = serviceByName.get(s.name.trim());
    if (!target) continue;
    if (s.serviceId === target.id) continue;
    await prisma.subCategory.update({
      where: { id: s.id },
      data: { serviceId: target.id },
    });
    linked++;
  }
  console.log(`  ✓ ${linked} sub-items linked (or relinked) to services`);

  console.log("\nDone.");
  console.log({
    renamedSubs,
    skippedSubs,
    transactionsStripped: Number(salesUpdated) + Number(collectionUpdated),
    pendingsUpdated: pendingsTouched,
    distinctServices: distinctNames.length,
    newServices: newCount,
    subsLinked: linked,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
