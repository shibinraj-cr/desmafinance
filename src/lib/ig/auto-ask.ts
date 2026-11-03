/**
 * Auto-ask: replying to a new Instagram DM to ask for the details a lead needs.
 *
 * Pure decision + wording, pinned by tests/ig-auto-ask.test.ts. The ingest
 * (src/lib/ig/ingest.ts) asks `decideAutoAsk` after every inbound message and
 * does the sending.
 *
 * Everything here leans toward silence, because a wrong automated message is
 * worse than none — it speaks as DESMA, to a candidate, in a conversation a
 * person may already be having:
 *
 *   - It only ever STARTS on a candidate's first message to us. A thread that
 *     was already going when DesGro connected, or when auto-ask was switched
 *     on, is never interrupted by an intro.
 *   - Two asks at most (intro + one follow-up). After that a person carries it.
 *   - A follow-up is sent only when the candidate's reply ADDED a detail but
 *     left some missing. "What are the fees?" gets no robotic re-ask; the team
 *     answers that.
 *   - The moment anyone on the team replies by hand, it stops for good.
 *   - An existing candidate is never interviewed — they are already a lead.
 *   - One thank-you, once everything is in.
 */
import { fillTemplate } from "../crm";
import type { DetailField } from "./extract";

export const IG_MAX_ASKS = 2;

export const DEFAULT_IG_INTRO =
  "Hi {first_name}! Thanks for reaching out to DESMA 😊\nTo have a counsellor contact you, please share your name, phone number, email ID and qualification.";
export const DEFAULT_IG_FOLLOWUP = "Thanks {first_name}! Could you also share your {missing}?";
export const DEFAULT_IG_THANKS = "Got it, thank you {first_name}! A DESMA counsellor will contact you shortly.";

/** Instagram allows up to 13 quick replies, each title at most 20 characters. */
export const IG_MAX_QUICK_REPLIES = 13;
export const IG_QUICK_REPLY_TITLE_MAX = 20;

export type AutoAskState = {
  enabled: boolean;
  humanRepliedAt: Date | null;
  /** Set when auto-ask may never speak here (see IgContact.autoAskBlocked). */
  blocked: string | null;
  thankedAt: Date | null;
  askCount: number;
  /** Linked to a lead that existed before this contact wrote. */
  existingLead: boolean;
  /** This is the first message the candidate has ever sent us. */
  firstInbound: boolean;
  /** This message filled in a phone, email or qualification we did not have. */
  addedDetail: boolean;
  /** Still unknown after this message. */
  missing: DetailField[];
};

export type AutoAskDecision =
  | { action: "none"; reason: string }
  | { action: "intro" }
  | { action: "follow_up" }
  | { action: "thanks" };

export function decideAutoAsk(s: AutoAskState): AutoAskDecision {
  if (!s.enabled) return { action: "none", reason: "disabled" };
  if (s.humanRepliedAt) return { action: "none", reason: "human_replied" };
  if (s.blocked) return { action: "none", reason: s.blocked };
  if (s.thankedAt) return { action: "none", reason: "done" };

  // Only a conversation auto-ask itself opened (or one that opens now) is ours
  // to continue. Anything else predates it and belongs to a person.
  const ours = s.firstInbound || s.askCount > 0;
  if (!ours) return { action: "none", reason: "not_started_by_auto_ask" };

  // Their number or email belongs to a candidate we already have — the
  // consultant's re-inquiry task carries it from here. Close politely.
  if (s.existingLead) return { action: "thanks" };

  if (s.missing.length === 0) return { action: "thanks" };

  if (s.askCount === 0) {
    // A first message that already gave something gets asked only for the rest
    // — repeating "please share your phone number" to someone who just did
    // reads like nobody is listening.
    return s.addedDetail ? { action: "follow_up" } : { action: "intro" };
  }

  if (s.askCount >= IG_MAX_ASKS) return { action: "none", reason: "ask_limit" };
  if (!s.addedDetail) return { action: "none", reason: "no_new_detail" };
  return { action: "follow_up" };
}

const FIELD_WORDS: Record<DetailField, string> = {
  phone: "phone number",
  email: "email ID",
  qualification: "qualification",
};

/** "phone number", "email ID and qualification", "phone number, email ID and qualification". */
export function describeMissing(missing: DetailField[]): string {
  const words = missing.map((f) => FIELD_WORDS[f]);
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Fill a wording template. `{first_name}` and `{missing}` are the merge
 * fields; an empty value leaves no stray space before punctuation ("Hi !"),
 * since most contacts have no name until they type one.
 */
export function renderAutoAskText(template: string, vars: { firstName: string | null; missing: DetailField[] }): string {
  const filled = fillTemplate(template, {
    first_name: vars.firstName?.trim() || "",
    name: vars.firstName?.trim() || "",
    missing: describeMissing(vars.missing),
  });
  return filled
    .replace(/[ \t]+([!?.,])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** First word of the best name we have — what a person would call them. */
export function firstNameOf(...names: (string | null | undefined)[]): string | null {
  for (const n of names) {
    // Skip handles and numbers; "Hi @anjali_rn_22!" and "Hi +9198…!" both read
    // worse than a plain "Hi!".
    const first = (n ?? "").trim().split(/\s+/)[0] ?? "";
    if (first && /^[A-Za-z][A-Za-z'’.-]*$/.test(first)) return first;
  }
  return null;
}

export type QuickReply = { content_type: "text"; title: string; payload: string };

/** Qualification buttons, at most 13, titles cut to Instagram's 20 characters. */
export function qualificationQuickReplies(
  options: { id: string; label: string }[],
  payloadFor: (id: string) => string,
): QuickReply[] {
  return options.slice(0, IG_MAX_QUICK_REPLIES).map((o) => ({
    content_type: "text",
    title: o.label.length > IG_QUICK_REPLY_TITLE_MAX ? `${o.label.slice(0, IG_QUICK_REPLY_TITLE_MAX - 1)}…` : o.label,
    payload: payloadFor(o.id),
  }));
}
