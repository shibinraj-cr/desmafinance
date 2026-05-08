import { prisma } from "./prisma";
import type { MasterCategory, MasterParty } from "@/components/TransactionForm";

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
 */
export async function getTransactionFormMasters(): Promise<{
  categories: MasterCategory[];
  parties: MasterParty[];
}> {
  const [cats, parties] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: { subItems: { orderBy: { name: "asc" } } },
    }),
    prisma.party.findMany({
      where: { isActive: true },
      orderBy: [{ group: "asc" }, { name: "asc" }],
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
  };
}
