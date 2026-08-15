import { describe, it, expect } from "vitest";
import { findRecordArray, normalizeWabisMessage, redactSample } from "@/lib/wa/wabis-import";

/**
 * These cover the parts written against an UNDOCUMENTED response shape, which is
 * exactly where a wrong assumption would go unnoticed: finding the records in an
 * unknown envelope, and reading direction / content / media out of a record
 * whose field names we are guessing at.
 */

describe("findRecordArray", () => {
  it("finds records under whichever key Wabis used", () => {
    for (const key of ["data", "messages", "conversation", "result"]) {
      const payload = { status: "1", [key]: [{ id: "1" }, { id: "2" }] };
      expect(findRecordArray(payload)).toHaveLength(2);
    }
  });

  it("finds records nested one level down", () => {
    expect(findRecordArray({ data: { messages: [{ id: "1" }] } })).toHaveLength(1);
  });

  it("takes the LONGEST array, so a stray one-element field cannot win", () => {
    const payload = { meta: [{ page: 1 }], data: [{ id: "1" }, { id: "2" }, { id: "3" }] };
    expect(findRecordArray(payload)).toHaveLength(3);
  });

  it("handles a bare array response", () => {
    expect(findRecordArray([{ id: "1" }])).toHaveLength(1);
  });

  it("is empty rather than throwing on junk", () => {
    expect(findRecordArray(null)).toEqual([]);
    expect(findRecordArray({ status: "0", message: "no" })).toEqual([]);
    expect(findRecordArray("nope")).toEqual([]);
  });
});

describe("normalizeWabisMessage", () => {
  it("reads a wamid under any of its plausible names", () => {
    expect(normalizeWabisMessage({ wa_message_id: "wamid.A" }).providerMessageId).toBe("wamid.A");
    expect(normalizeWabisMessage({ message_id: "wamid.B" }).providerMessageId).toBe("wamid.B");
  });

  // Getting this backwards would put our own replies in the candidate's bubble.
  it("recognises outbound under several conventions", () => {
    for (const raw of [
      { direction: "out" },
      { direction: "outgoing" },
      { type_of_message: "sent" },
      { sent_by: "agent" },
      { is_outgoing: true },
      { from_business: true },
    ]) {
      expect(normalizeWabisMessage(raw).direction).toBe("out");
    }
  });

  it("treats anything unrecognised as INBOUND — the safer misfile", () => {
    expect(normalizeWabisMessage({}).direction).toBe("in");
    expect(normalizeWabisMessage({ direction: "something_new" }).direction).toBe("in");
  });

  it("reads the body under any of its plausible names", () => {
    expect(normalizeWabisMessage({ message_content: "hello" }).body).toBe("hello");
    expect(normalizeWabisMessage({ text: "hello" }).body).toBe("hello");
  });

  it("pulls a media URL out of an explicit field", () => {
    const m = normalizeWabisMessage({ media_url: "https://bot-data.s3.example.com/a.ogg" });
    expect(m.mediaUrl).toBe("https://bot-data.s3.example.com/a.ogg");
  });

  // Wabis renders the storage URL inline in the message content, so it can
  // arrive as the body rather than in a field of its own.
  it("recovers a storage URL embedded in the message text", () => {
    const url = "https://bot-data.s3.ap-southeast-1.wasabisys.com/livechat/2026/8/whatsapp-1/2-1-3.ogg";
    expect(normalizeWabisMessage({ message_content: `🎙 Audio : ${url}` }).mediaUrl).toBe(url);
  });

  it("treats a bare URL body as the media itself", () => {
    const url = "https://example.com/file.pdf";
    expect(normalizeWabisMessage({ message_content: url }).mediaUrl).toBe(url);
  });

  it("leaves mediaUrl null for ordinary text", () => {
    expect(normalizeWabisMessage({ message_content: "just talking" }).mediaUrl).toBeNull();
  });

  it("reads a timestamp under any of its plausible names", () => {
    expect(normalizeWabisMessage({ created_at: "2026-08-01T10:00:00Z" }).occurredAt?.toISOString()).toBe(
      "2026-08-01T10:00:00.000Z",
    );
    expect(normalizeWabisMessage({ timestamp: "1754308800" }).occurredAt?.toISOString()).toBe(
      "2025-08-04T12:00:00.000Z",
    );
  });

  it("is null-timestamped rather than wrong when nothing parses", () => {
    expect(normalizeWabisMessage({ message_content: "hi" }).occurredAt).toBeNull();
  });
});

describe("redactSample", () => {
  it("strips anything that looks like a credential before it reaches a browser", () => {
    const out = redactSample({ apiToken: "secret", access_key: "s", body: "hello" }) as Record<string, unknown>;
    expect(out.apiToken).toBe("«redacted»");
    expect(out.access_key).toBe("«redacted»");
    expect(out.body).toBe("hello");
  });

  it("passes through a non-object unchanged", () => {
    expect(redactSample("plain")).toBe("plain");
  });
});
