import { describe, it, expect } from "vitest";
import {
  decideAutoAsk,
  describeMissing,
  DEFAULT_IG_FOLLOWUP,
  DEFAULT_IG_INTRO,
  DEFAULT_IG_THANKS,
  firstNameOf,
  IG_MAX_QUICK_REPLIES,
  qualificationQuickReplies,
  renderAutoAskText,
  type AutoAskState,
} from "@/lib/ig/auto-ask";

const base: AutoAskState = {
  enabled: true,
  humanRepliedAt: null,
  blocked: null,
  thankedAt: null,
  askCount: 0,
  existingLead: false,
  firstInbound: true,
  addedDetail: false,
  missing: ["phone", "email", "qualification"],
};

describe("decideAutoAsk", () => {
  it("does nothing while switched off", () => {
    expect(decideAutoAsk({ ...base, enabled: false })).toEqual({ action: "none", reason: "disabled" });
  });

  it("sends the intro to a first 'hi'", () => {
    expect(decideAutoAsk(base)).toEqual({ action: "intro" });
  });

  it("asks only for the rest when the first message already gave something", () => {
    expect(decideAutoAsk({ ...base, addedDetail: true, missing: ["email", "qualification"] })).toEqual({ action: "follow_up" });
  });

  it("thanks straight away when the first message had everything", () => {
    expect(decideAutoAsk({ ...base, addedDetail: true, missing: [] })).toEqual({ action: "thanks" });
  });

  it("follows up once when a reply added a detail but left some missing", () => {
    expect(decideAutoAsk({ ...base, firstInbound: false, askCount: 1, addedDetail: true, missing: ["email"] })).toEqual({
      action: "follow_up",
    });
  });

  it("does not re-ask when the reply added nothing ('what are the fees?')", () => {
    expect(decideAutoAsk({ ...base, firstInbound: false, askCount: 1 })).toEqual({ action: "none", reason: "no_new_detail" });
  });

  it("stops at two asks", () => {
    expect(decideAutoAsk({ ...base, firstInbound: false, askCount: 2, addedDetail: true, missing: ["qualification"] })).toEqual({
      action: "none",
      reason: "ask_limit",
    });
  });

  it("thanks once everything is in, even after the ask limit", () => {
    expect(decideAutoAsk({ ...base, firstInbound: false, askCount: 2, addedDetail: true, missing: [] })).toEqual({
      action: "thanks",
    });
  });

  it("never thanks twice", () => {
    expect(decideAutoAsk({ ...base, thankedAt: new Date(), missing: [] })).toEqual({ action: "none", reason: "done" });
  });

  it("falls silent for good once a person on the team replies", () => {
    expect(decideAutoAsk({ ...base, humanRepliedAt: new Date() })).toEqual({ action: "none", reason: "human_replied" });
  });

  it("stays out of a chat that predates it", () => {
    expect(decideAutoAsk({ ...base, blocked: "earlier_conversation" })).toEqual({ action: "none", reason: "earlier_conversation" });
  });

  it("never opens with an intro mid-conversation (switched on after the chat began)", () => {
    expect(decideAutoAsk({ ...base, firstInbound: false, askCount: 0, addedDetail: true })).toEqual({
      action: "none",
      reason: "not_started_by_auto_ask",
    });
  });

  it("closes politely for an existing candidate instead of interviewing them", () => {
    expect(decideAutoAsk({ ...base, existingLead: true, addedDetail: true, missing: ["email"] })).toEqual({ action: "thanks" });
    expect(decideAutoAsk({ ...base, existingLead: true, firstInbound: false, askCount: 0 })).toEqual({
      action: "none",
      reason: "not_started_by_auto_ask",
    });
  });
});

describe("wording", () => {
  it("joins missing fields the way a person would", () => {
    expect(describeMissing(["email"])).toBe("email ID");
    expect(describeMissing(["email", "qualification"])).toBe("email ID and qualification");
    expect(describeMissing(["phone", "email", "qualification"])).toBe("phone number, email ID and qualification");
  });

  it("leaves no stray space when there is no name yet", () => {
    expect(renderAutoAskText(DEFAULT_IG_INTRO, { firstName: null, missing: [] }).startsWith("Hi! Thanks")).toBe(true);
    expect(renderAutoAskText(DEFAULT_IG_FOLLOWUP, { firstName: null, missing: ["email", "qualification"] })).toBe(
      "Thanks! Could you also share your email ID and qualification?",
    );
  });

  it("uses the first name when there is one", () => {
    expect(renderAutoAskText(DEFAULT_IG_THANKS, { firstName: "Anjali", missing: [] })).toBe(
      "Got it, thank you Anjali! A DESMA counsellor will contact you shortly.",
    );
  });

  it("keeps the intro's line break", () => {
    expect(renderAutoAskText(DEFAULT_IG_INTRO, { firstName: "Anjali", missing: [] })).toContain("😊\nTo have");
  });

  it("does not greet anyone by their handle or number", () => {
    expect(firstNameOf(null, "anjali_rn_22")).toBeNull();
    expect(firstNameOf("+919876543210")).toBeNull();
    expect(firstNameOf(null, "Anjali Mary")).toBe("Anjali");
  });
});

describe("qualificationQuickReplies", () => {
  it("caps at Instagram's 13 and trims titles to 20 characters", () => {
    const opts = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, label: i === 0 ? "Post Basic BSc Nursing (Hons)" : `Q${i}` }));
    const qr = qualificationQuickReplies(opts, (id) => `p:${id}`);
    expect(qr).toHaveLength(IG_MAX_QUICK_REPLIES);
    expect(qr[0].title.length).toBeLessThanOrEqual(20);
    expect(qr[0]).toMatchObject({ content_type: "text", payload: "p:q0" });
  });
});
