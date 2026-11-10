import type { Permissions } from "@/lib/rbac";
import { canSeePage } from "@/lib/rbac";
import { getOpsAccess } from "@/lib/ops-rbac";
import { AGREEMENT_TEMPLATES_PAGE } from "./templates";

/**
 * Agreements (E-Sign) — the pure rules behind template categories.
 *
 * Categories group templates for the filters and the send wizard. They were
 * fixed in code until they moved to EsignTemplateCategory. No I/O here; the
 * database calls live in categories-store.ts and the API routes. Two
 * decisions worth knowing first:
 *
 * 1. **Templates store the category's name.** Renaming a category renames it
 *    on every template in it. Agreements already sent keep the name they were
 *    sent under (EsignRequest.category is a snapshot).
 *
 * 2. **Archive, don't delete.** Archiving stops a category being offered for
 *    templates; those already in it keep it. Only a category no template uses
 *    can be deleted.
 */

/** Not a page grant of its own: see canManageAgreementCategories. */
export const AGREEMENT_CATEGORIES_PAGE = "/operations/agreements/templates/categories";

/**
 * Who may add, rename, reorder, archive and delete categories: whoever manages
 * agreement templates, plus the Operations-manager tier (the Operations
 * Manager role, through its /operations/settings grant), who reach the page
 * from Operations Settings. Admins pass both.
 */
export function canManageAgreementCategories(userId: string, perms: Permissions | null): boolean {
  if (!perms) return false;
  return canSeePage(perms, AGREEMENT_TEMPLATES_PAGE) || getOpsAccess(userId, perms).isOpsManager;
}

/** A category name as stored: whitespace tidied, control characters dropped. */
export function cleanCategoryName(raw: string): string | null {
  const name = raw
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return name || null;
}

export type CategoryOption = { name: string; active: boolean };

/**
 * What a template's category picker offers: the active categories in order,
 * plus the template's own category when it is archived or missing, so opening
 * an older template never quietly moves it to another category.
 */
export function categoryChoices(categories: CategoryOption[], current?: string | null): CategoryOption[] {
  const active = categories.filter((c) => c.active);
  if (!current || active.some((c) => c.name === current)) return active;
  return [...active, { name: current, active: false }];
}

/**
 * The ids in their new order after moving one a place up or down. Unchanged
 * when it is already at that end, or not in the list.
 */
export function moveCategory(ids: string[], id: string, direction: "up" | "down"): string[] {
  const i = ids.indexOf(id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
