import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { canManageUsers } from "@/lib/rbac";
import { getCurrentUserAndPermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Admin-only one-shot endpoint that runs the same logic as
 * `prisma/migrate-expense-master.ts`: reshapes the live Expense
 * master to match the new 15-category list.
 *
 * Idempotent — re-running is a no-op once everything is in the
 * desired state. Deactivates rather than deletes so historical
 * Transaction rows remain readable.
 *
 * Mirroring the script keeps this in lockstep with the CLI version;
 * if the desired master changes, edit both.
 */
const NEW_EXPENSE_MAP: Record<string, string[]> = {
  "Bank Fee and Charges": ["Bank Fee and Charges"],
  "Consulting Fee": ["Consulting Fee"],
  "Legal and Professional Fees": ["Legal and Professional Fees"],
  Marketing: [
    "Designs & Editing",
    "Digital Advertisement - Google",
    "Digital Advertisement - Meta",
    "Digital Marketing Management Fee",
  ],
  "Office Supplies": ["Office Supplies"],
  "Recruitment Fee": ["Recruitment Fee"],
  Refund: ["Refund"],
  Rent: ["Rent"],
  "Repairs and Maintenance": ["Repairs and Maintenance"],
  Salary: [
    "Cleaning Staff",
    "Directors",
    "Incentive",
    "Operational Team",
    "Sales Team",
    "Senior Team",
  ],
  "Software Tools": ["Software Tools"],
  "Staff Welfare": ["EPFO", "ESIC", "Meals and Entertainment"],
  Taxes: ["GST", "TDS"],
  "Telephone and Internet": ["Telephone and Internet"],
  "Travel & Transportation": ["Accommodation and Lodging", "Fuel"],
};

const UNTOUCHED_EXPENSE_CATEGORIES = new Set(["Commissions"]);

export async function POST() {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageUsers(perms)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const log: string[] = [];
  let categoriesCreated = 0;
  let categoriesActivated = 0;
  let categoriesDeactivated = 0;
  let subItemsCreated = 0;
  let subItemsActivated = 0;
  let subItemsDeactivated = 0;

  for (const [catName, subs] of Object.entries(NEW_EXPENSE_MAP)) {
    const existing = await prisma.category.findUnique({
      where: { name_type: { name: catName, type: "Expense" } },
    });
    let cat;
    if (existing) {
      cat = existing.isActive
        ? existing
        : await prisma.category.update({
            where: { id: existing.id },
            data: { isActive: true },
          });
      if (!existing.isActive) {
        categoriesActivated++;
        log.push(`re-activated category: ${catName}`);
      }
    } else {
      cat = await prisma.category.create({
        data: { name: catName, type: "Expense", isActive: true },
      });
      categoriesCreated++;
      log.push(`created category: ${catName}`);
    }

    for (const subName of subs) {
      const existingSub = await prisma.subCategory.findUnique({
        where: { categoryId_name: { categoryId: cat.id, name: subName } },
      });
      if (existingSub) {
        if (!existingSub.isActive) {
          await prisma.subCategory.update({
            where: { id: existingSub.id },
            data: { isActive: true },
          });
          subItemsActivated++;
          log.push(`re-activated sub-item: ${catName} → ${subName}`);
        }
      } else {
        await prisma.subCategory.create({
          data: { categoryId: cat.id, name: subName, isActive: true },
        });
        subItemsCreated++;
        log.push(`created sub-item: ${catName} → ${subName}`);
      }
    }

    const allSubs = await prisma.subCategory.findMany({
      where: { categoryId: cat.id },
    });
    const wanted = new Set(subs);
    for (const s of allSubs) {
      if (!wanted.has(s.name) && s.isActive) {
        await prisma.subCategory.update({
          where: { id: s.id },
          data: { isActive: false },
        });
        subItemsDeactivated++;
        log.push(`deactivated sub-item: ${catName} → ${s.name}`);
      }
    }
  }

  const allExpenseCats = await prisma.category.findMany({
    where: { type: "Expense" },
  });
  const wantedCatNames = new Set(Object.keys(NEW_EXPENSE_MAP));
  for (const c of allExpenseCats) {
    if (wantedCatNames.has(c.name)) continue;
    if (UNTOUCHED_EXPENSE_CATEGORIES.has(c.name)) continue;
    if (!c.isActive) continue;
    await prisma.category.update({
      where: { id: c.id },
      data: { isActive: false },
    });
    categoriesDeactivated++;
    log.push(`deactivated category: ${c.name}`);
  }

  const summary = {
    categoriesCreated,
    categoriesActivated,
    categoriesDeactivated,
    subItemsCreated,
    subItemsActivated,
    subItemsDeactivated,
  };

  await recordAudit({
    userId,
    entityType: "Category",
    entityId: "__expense_master_migration__",
    action: "UPDATE",
    changes: { kind: "expense_master_migration", ...summary, log },
  });

  return NextResponse.json({ ok: true, summary, log });
}
