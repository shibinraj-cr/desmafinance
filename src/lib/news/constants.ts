/**
 * Constants shared between the server-side feed queries and the client
 * components that render the badge. Kept apart from `read.ts` because that
 * module imports Prisma, which must never be pulled into a client bundle.
 */

/**
 * How far back the feed and the unread badge look.
 *
 * Bounding this matters more than it looks: unread is the *absence* of a read
 * receipt, so without a window every user who joins later inherits an unread
 * count equal to the entire archive. A window makes the badge mean "new lately",
 * which is how a user reads it.
 */
export const NEWS_WINDOW_DAYS = 60;

/** The badge renders "99+" past this, so a long absence cannot widen the nav. */
export const NEWS_BADGE_CAP = 99;

/** Badge text for an unread count. */
export function newsBadgeLabel(count: number): string {
  return count > NEWS_BADGE_CAP ? `${NEWS_BADGE_CAP}+` : String(count);
}
