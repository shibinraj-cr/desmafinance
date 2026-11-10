import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { badRequest, forbidden, unauthorized } from "@/lib/http-error";
import { canManageAgreementCategories } from "./categories";

/** Server-side half of agreement template categories. */

/** Every category API call goes through this. */
export async function requireCategoryManager(): Promise<{ userId: string }> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  if (!canManageAgreementCategories(userId, perms)) throw forbidden();
  return { userId };
}

/** Every category in display order, archived ones included. */
export function listTemplateCategories() {
  return prisma.esignTemplateCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, active: true },
  });
}

/** A category with this name, compared the way a person reads names (case-blind). */
export async function templateCategoryNamed(name: string, exceptId?: string) {
  return prisma.esignTemplateCategory.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true, name: true, active: true },
  });
}

/**
 * The stored name of the category a template is being put in. Matched
 * case-blind, so the template carries the category's exact spelling and a
 * later rename finds it. Unknown and archived categories are refused.
 */
export async function requireActiveCategory(name: string): Promise<string> {
  const found = await templateCategoryNamed(name);
  if (!found || !found.active) {
    throw badRequest("Choose one of the categories in the list.", "unknown_category");
  }
  return found.name;
}
