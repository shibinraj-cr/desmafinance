import { forbidden, unauthorized } from "./http-error";
import { getCurrentUserAndPermissions } from "./permissions";

export const WEALTH_PAGE = "/executive/wealth";

/**
 * Who may use the Personal Wealth desk.
 *
 * Two layers, and the second is the one that matters:
 *
 *  - the PAGE is admin-only, like the rest of the Executive module;
 *  - the DATA is owner-only — every query in lib/wealth filters on the id this
 *    returns, so a second admin signing in gets their own empty desk rather
 *    than a view of someone else's finances.
 *
 * That is why there is no allow-list to configure and no environment variable
 * to forget: the isolation is a property of the schema, not of a setting.
 */
export async function requireWealthOwner(): Promise<string> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!userId) throw unauthorized();
  if (!perms?.isAdmin) throw forbidden("The Personal Wealth desk is admin-only.");
  return userId;
}

/** Non-throwing variant for the page, which renders its own refusal. */
export async function getWealthOwner(): Promise<{ userId: string | null; allowed: boolean }> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  return { userId: userId ?? null, allowed: !!userId && !!perms?.isAdmin };
}
