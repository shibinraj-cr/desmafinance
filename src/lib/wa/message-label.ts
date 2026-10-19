/**
 * What to SHOW for a WhatsApp message, when its body alone does not say it.
 *
 * Pure and dependency-free, because the inbox, the lead page, the inbox list
 * preview and the broadcast report all print the same message, and each used to
 * fall back to a raw `[${type}]` of its own — which is how a candidate's 👍 on a
 * campaign template reached a consultant as "[unsupported]".
 */

export type WaMessageLabelInput = {
  type: string;
  body: string | null;
  unsupportedType?: string | null;
  hasMedia?: boolean;
};

/**
 * Meta's `unsupported.type` values, as something a consultant can act on. Meta
 * never sends the content of any of these — the kind is all there is.
 */
const UNSUPPORTED_LABELS: Record<string, string> = {
  reaction: "Reacted to a message",
  edit: "Edited an earlier message",
  poll_creation: "Sent a poll",
  poll_update: "Voted in a poll",
  pin: "Pinned a message",
  keep_in_chat: "Kept a disappearing message",
  gif: "Sent a GIF",
  image: "Sent a photo",
  media_placeholder: "Sent media that isn't available",
  group_invite: "Sent a group invite",
  link_preview: "Sent a link",
  location: "Shared a location",
  order: "Sent an order",
  product: "Shared a product",
  button: "Tapped a button",
  interactive: "Sent an interactive message",
  list: "Sent a list message",
  hsm: "Sent a template message",
  request_welcome: "Opened the chat",
  unavailable: "Message not available yet",
};

const UNSUPPORTED_FALLBACK = "Sent a message WhatsApp can't show here";

/** Is this a message whose content WhatsApp withheld, rather than one the candidate wrote? */
export function isWithheldMessage(m: Pick<WaMessageLabelInput, "type">): boolean {
  return m.type === "unsupported";
}

/**
 * The line to print for a message: its own words when it has any, otherwise a
 * description of what happened. Null when there is nothing to add — a text with
 * no body, or media that already has a player on screen ("[audio]" next to a
 * player reads as the message having failed to load).
 */
export function waMessageText(m: WaMessageLabelInput): string | null {
  const body = m.body?.trim() || null;
  if (m.type === "reaction") return body ? `Reacted ${body}` : UNSUPPORTED_LABELS.reaction;
  if (body) return body;
  if (m.type === "unsupported") return (m.unsupportedType && UNSUPPORTED_LABELS[m.unsupportedType]) || UNSUPPORTED_FALLBACK;
  if (m.type === "text" || m.hasMedia) return null;
  return `[${m.type}]`;
}

/** Why the content is missing, for a tooltip — null when nothing is missing. */
export function withheldHint(m: WaMessageLabelInput): string | null {
  if (!isWithheldMessage(m)) return null;
  if (m.unsupportedType === "unavailable") {
    return "WhatsApp hasn't released this message's content yet. If it doesn't appear, ask the candidate to send it again.";
  }
  return "WhatsApp doesn't pass this kind of message to the CRM, so its content can't be shown. If it matters, ask the candidate to send it again as text.";
}
