/**
 * Which WhatsApp failures mean the NUMBER is dead, as opposed to this one send.
 *
 * One list for every sender. The re-marketing drip and broadcasts used to keep
 * their own copies with different answers (the drip also counted 131000 and
 * 131047), and the flag they set is read by everything else — task reminders,
 * e-sign links, every future campaign — so the stricter copy silently cut off
 * candidates the other would still have reached.
 *
 * Deliberately narrow: only 131026 ("not on WhatsApp / invalid number") is a
 * verdict about the number. 131000 is Meta's generic error, 131047 is the closed
 * 24-hour window, 131049 is the per-user marketing cap — each says "not this
 * message, not now", and flagging a working number over one of them would
 * silence the candidate for good.
 */
export const PERMANENT_UNDELIVERABLE_CODES: ReadonlySet<string> = new Set(["131026"]);

export function isPermanentUndeliverable(errorCode: string | null | undefined): boolean {
  return !!errorCode && PERMANENT_UNDELIVERABLE_CODES.has(errorCode);
}
