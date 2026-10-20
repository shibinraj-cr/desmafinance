"use client";

import { waMessageText, withheldHint, type WaMessageLabelInput } from "@/lib/wa/message-label";

/**
 * The text line inside a message bubble, shared by the inbox and the lead page
 * so the two threads describe a message the same way.
 *
 * A message whose content WhatsApp withheld (an edit, a poll, some reactions)
 * is set apart in muted italics with the reason on hover: printed like ordinary
 * text, "Edited an earlier message" would read as something the candidate typed.
 */
export function WaMessageText({ message }: { message: WaMessageLabelInput }) {
  const text = waMessageText(message);
  if (!text) return null;

  const hint = withheldHint(message);
  if (hint) {
    return (
      <p className="flex items-start gap-xs text-body-md italic text-on-surface-variant" title={hint}>
        <span className="material-symbols-outlined not-italic" style={{ fontSize: 16 }} aria-label={hint}>
          info
        </span>
        <span>{text}</span>
      </p>
    );
  }

  return <p className="text-body-md text-on-surface whitespace-pre-wrap break-words">{text}</p>;
}
