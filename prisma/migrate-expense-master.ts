/**
 * One-off, idempotent reshape of the Expense master.
 *
 * Source of truth: NEW_EXPENSE_MAP below. The script:
 *   1. Upserts each Category in the map (type='Expense', isActive=true).
 *   2. Upserts each SubCategory under it (isActive=true).
 *   3. Deactivates any SubCategory under a surviving category that
 *      isn't in the new sub-list.
 *   4. Deactivates any Expense Category not in the new map and not
 *      `Commissions`.
 *
 * No Transaction rows are touched — historical category/subItem
 * strings remain valid because Transaction stores them denormalised.
 *
 * Run:
 *   npm run db:migrate-expense-master
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const NEW_EXPENSE_MAP: Record<string, string[]> = {
  "Bank Fee and Charges": ["Bank Fee and Charges"],
  "Buying Assets": ["Buying Assets"],
  "Consulting Fee": ["Consulting Fee"],
  "Legal and Professional Fees": [
    "Advocate / CA Fees",
    "Notary and Attestation Charges",
    "Stamp Paper - Attestation",
    "ROC / MCA Filing Fees",
  ],
  "Loan Repayment": ["Loan Repayment"],
  Marketing: [
    "Designs & Editing",
    "Digital Advertisement - Google",
    "Digital Advertisement - Meta",
    "Digital Marketing Management Fee",
  ],
  "Miscellaneous Expenses": ["Labour Charges", "Waste Collection"],
  "Office Supplies": ["Office Supplies", "Drinking Water Charges"],
  "Recruitment Fee": ["Recruitment Fee"],
  Refund: ["Refund"],
  Rent: ["Rent"],
  "Repairs and Maintenance": [
    "Repairs and Maintenance",
    "Shutter Operating Charges",
  ],
  Salary: [
    "Cleaning Staff",
    "Directors",
    "Incentive",
    "Operational Team",
    "Sales Team",
    "Senior Team",
    "Trainee Stipend",
  ],
  "Software Tools": ["Software Tools"],
  "Staff Welfare": [
    "EPFO",
    "ESIC",
    "Meals and Entertainment",
    "Office Tea Expense",
  ],
  Taxes: ["GST", "TDS"],
  "Telephone and Internet": ["Telephone and Internet"],
  "Travel & Transportation": ["Accommodation and Lodging", "Fuel"],
};

/** Categories that survive even though they're not in the new map. */
const UNTOUCHED_EXPENSE_CATEGORIES = new Set(["Commissions"]);

async function main() {
  let categoriesUpserted = 0;
  let categoriesActivated = 0;
  let subItemsUpserted = 0;
  let subItemsActivated = 0;
  let subItemsDeactivated = 0;
  let categoriesDeactivated = 0;

  console.log("Step 1 — Upsert categories + sub-items per the new map…");
  for (const [catName, subs] of Object.entries(NEW_EXPENSE_MAP)) {
    const existing = await prisma.category.findUnique({
      where: { name_type: { name: catName, type: "Expense" } },
    });
    let cat;
    if (existing) {
      cat = await prisma.category.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
      if (!existing.isActive) categoriesActivated++;
    } else {
      cat = await prisma.category.create({
        data: { name: catName, type: "Expense", isActive: true },
      });
      categoriesUpserted++;
      console.log(`  + Created category: ${catName}`);
    }

    // Upsert each desired sub-item.
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
        }
      } else {
        await prisma.subCategory.create({
          data: { categoryId: cat.id, name: subName, isActive: true },
        });
        subItemsUpserted++;
        console.log(`  + Sub-item: ${catName} → ${subName}`);
      }
    }

    // Deactivate sub-items under this category that aren't in the new list.
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
        console.log(`  − Deactivated sub-item: ${catName} → ${s.name}`);
      }
    }
  }

  console.log(
    "\nStep 2 — Deactivate Expense categories no longer in the new map…",
  );
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
    console.log(`  − Deactivated category: ${c.name}`);
  }

  console.log("\n=========== SUMMARY ===========");
  console.log(`Categories created           : ${categoriesUpserted}`);
  console.log(`Categories re-activated      : ${categoriesActivated}`);
  console.log(`Categories deactivated       : ${categoriesDeactivated}`);
  console.log(`Sub-items created            : ${subItemsUpserted}`);
  console.log(`Sub-items re-activated       : ${subItemsActivated}`);
  console.log(`Sub-items deactivated        : ${subItemsDeactivated}`);
  console.log(
    `Categories untouched (kept) : ${[...UNTOUCHED_EXPENSE_CATEGORIES].join(", ")}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
