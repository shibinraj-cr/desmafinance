/**
 * What a delivery tick says when you hover it.
 *
 * The tick alone answers "did it arrive". The two questions that actually get
 * asked next are "when" and, for a failure, "why" — and a bare Meta error code
 * answers neither. Shared so the inbox and the lead page cannot drift into
 * saying different things about the same message.
 */
export function statusTooltip(
  label: string,
  message: { waStatusAt: string | null; waErrorCode: string | null; waErrorMessage: string | null },
): string {
  const parts = [label];

  if (message.waStatusAt) {
    const at = new Date(message.waStatusAt);
    if (!Number.isNaN(at.getTime())) {
      parts[0] = `${label} ${at.toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
  }

  // Meta's own sentence first — it names the actual problem ("Message failed to
  // send because more than 24 hours have passed…"). The code is kept alongside
  // because it is what a support thread will ask for.
  if (message.waErrorMessage) parts.push(message.waErrorMessage);
  if (message.waErrorCode) parts.push(`Meta error ${message.waErrorCode}`);

  return parts.join(" — ");
}
