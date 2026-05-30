import { prisma } from "./prisma";
import type { MasterCategory, MasterParty, MasterEmployee } from "@/components/TransactionForm";

// Categories whose sub-items can be linked to a Service. Service-aware
// reporting joins on these sub-items, so widening the set requires updating
// the relevant aggregations as well.
export const SERVICE_LINK_CATEGORIES = [
  "Sales - Nursing Registrations",
  "Collection - Nursing Registrations",
  "Sales - Study Abroad",
  "Collection - Study Abroad",
] as const;

export const SERVICE_LINK_CATEGORY_SET: ReadonlySet<string> = new Set(
  SERVICE_LINK_CATEGORIES,
);

/**
 * Validate that the (category, sub-item, type) triple exists in the master.
 * Returns null on success, or an error string suitable for an API response.
 */
export async function verifyCategorySubItem(
  category: string,
  subItem: string,
  type: string,
): Promise<string | null> {
  const cat = await prisma.category.findFirst({
    where: {
      name: category,
      OR: [{ type }, { type: "Both" }],
      isActive: true,
    },
    include: { subItems: true },
  });
  if (!cat) return "category_not_found";
  const sub = cat.subItems.find((s) => s.name === subItem && s.isActive);
  if (!sub) return "sub_item_not_found";
  return null;
}

/**
 * Server-side fetcher for the master data the transaction form needs.
 * Returns categories with sub-items and active parties.
 *
 * The Party query uses an explicit `select` instead of `findMany()`'s
 * default-all so it survives the brief window when newly-added Party
 * columns (e.g. `sourceId`, `assignedL2BdeId`) haven't been pushed to
 * the live DB yet. The transaction form only needs id/name/group/
 * txTypes/isActive anyway.
 */
export async function getTransactionFormMasters(): Promise<{
  categories: MasterCategory[];
  parties: MasterParty[];
  employees: MasterEmployee[];
}> {
  const [cats, parties, employees] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: { subItems: { orderBy: { name: "asc" } } },
    }),
    prisma.party.findMany({
      where: { isActive: true },
      orderBy: [{ group: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        group: true,
        txTypes: true,
        isActive: true,
      },
    }),
    // Active employees — selectable as the counterparty on Expense rows
    // (salary / incentive outflows). Only name + designation are exposed.
    prisma.employee.findMany({
      where: { active: true },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        designation: true,
        designationRef: { select: { name: true } },
      },
    }),
  ]);
  return {
    categories: cats.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type as "Revenue" | "Expense" | "Both",
      isActive: c.isActive,
      subItems: c.subItems.map((s) => ({
        id: s.id,
        name: s.name,
        isActive: s.isActive,
      })),
    })),
    parties: parties.map((p) => ({
      id: p.id,
      name: p.name,
      group: p.group as "Candidate" | "Vendor",
      txTypes: p.txTypes as "Revenue" | "Expense" | "Both",
      isActive: p.isActive,
    })),
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      designation: e.designationRef?.name ?? e.designation ?? null,
    })),
  };
}
