import { describe, it, expect } from "vitest";
import { isWithheldMessage, waMessageText, withheldHint } from "@/lib/wa/message-label";

describe("waMessageText", () => {
  it("prints the candidate's own words untouched", () => {
    expect(waMessageText({ type: "text", body: "  Interested  " })).toBe("Interested");
  });

  it("describes an unsupported message by what the candidate did, not as '[unsupported]'", () => {
    expect(waMessageText({ type: "unsupported", body: null, unsupportedType: "edit" })).toBe("Edited an earlier message");
    expect(waMessageText({ type: "unsupported", body: null, unsupportedType: "poll_creation" })).toBe("Sent a poll");
    expect(waMessageText({ type: "unsupported", body: null, unsupportedType: "reaction" })).toBe("Reacted to a message");
  });

  it("still says something readable for rows stored before the kind was kept", () => {
    expect(waMessageText({ type: "unsupported", body: null })).toBe("Sent a message WhatsApp can't show here");
    expect(waMessageText({ type: "unsupported", body: null, unsupportedType: "some_future_kind" })).toBe(
      "Sent a message WhatsApp can't show here",
    );
  });

  it("shows a reaction with its emoji", () => {
    expect(waMessageText({ type: "reaction", body: "👍" })).toBe("Reacted 👍");
  });

  it("keeps the type placeholder for captionless media with no player, and nothing when there is one", () => {
    expect(waMessageText({ type: "image", body: null })).toBe("[image]");
    expect(waMessageText({ type: "audio", body: null, hasMedia: true })).toBeNull();
  });

  it("is null for an empty text", () => {
    expect(waMessageText({ type: "text", body: "  " })).toBeNull();
  });
});

describe("withheldHint", () => {
  it("explains a withheld message, and nothing else", () => {
    expect(isWithheldMessage({ type: "unsupported" })).toBe(true);
    expect(withheldHint({ type: "unsupported", body: null, unsupportedType: "edit" })).toMatch(/send it again as text/);
    expect(withheldHint({ type: "unsupported", body: null, unsupportedType: "unavailable" })).toMatch(/hasn't released/);
    expect(withheldHint({ type: "text", body: "hi" })).toBeNull();
    expect(withheldHint({ type: "reaction", body: "👍" })).toBeNull();
  });
});
