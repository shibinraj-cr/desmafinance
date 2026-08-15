import { describe, it, expect } from "vitest";
import {
  extractInboundMessages,
  extractBody,
  normalizeMessageType,
  parseWaTimestamp,
} from "@/lib/wa/inbound";
import { advanceTimestamps, isSessionOpen, sessionExpiryFrom, WA_SESSION_WINDOW_MS } from "@/lib/wa/mirror";

/** Meta's real webhook shape, trimmed to the fields the parser reads. */
function metaEnvelope(messages: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages } }] }],
  };
}

describe("parseWaTimestamp", () => {
  it("reads WhatsApp's epoch-seconds string", () => {
    expect(parseWaTimestamp("1754308800")?.toISOString()).toBe("2025-08-04T12:00:00.000Z");
  });
  it("reads epoch milliseconds, in case a relay normalises for us", () => {
    expect(parseWaTimestamp("1754308800000")?.toISOString()).toBe("2025-08-04T12:00:00.000Z");
  });
  it("reads an ISO string", () => {
    expect(parseWaTimestamp("2026-08-13T09:30:00.000Z")?.toISOString()).toBe("2026-08-13T09:30:00.000Z");
  });
  it("rejects a pre-WhatsApp date rather than sorting it to the top of a thread forever", () => {
    expect(parseWaTimestamp("1970-01-01T00:00:00.000Z")).toBeNull();
  });
  it("applies the same plausibility bounds to NUMERIC epochs, not just ISO strings", () => {
    // 9 digits = the 1970s-90s; 11 digits = the year 2500. Both match the digit
    // pattern while being obvious misparses.
    expect(parseWaTimestamp("123456789")).toBeNull();
    expect(parseWaTimestamp("99999999999")).toBeNull();
    // 12-digit ms = 1973.
    expect(parseWaTimestamp("100000000000")).toBeNull();
  });
  it("rejects a future timestamp beyond ordinary clock skew", () => {
    const farFuture = Math.floor((Date.now() + 90 * 24 * 3600 * 1000) / 1000);
    expect(parseWaTimestamp(String(farFuture))).toBeNull();
  });
  it("still accepts a timestamp inside the clock-skew grace window", () => {
    const slightlyAhead = Math.floor((Date.now() + 60_000) / 1000);
    expect(parseWaTimestamp(String(slightlyAhead))).not.toBeNull();
  });
  it("is null on nothing usable", () => {
    expect(parseWaTimestamp(null)).toBeNull();
    expect(parseWaTimestamp("")).toBeNull();
    expect(parseWaTimestamp("not a date")).toBeNull();
  });
});

describe("normalizeMessageType", () => {
  it("passes through the types we store", () => {
    expect(normalizeMessageType("image")).toBe("image");
    expect(normalizeMessageType("DOCUMENT")).toBe("document");
  });
  it("defaults to text when absent", () => {
    expect(normalizeMessageType(undefined)).toBe("text");
  });
  it("files anything unrecognised as unsupported rather than inventing a type", () => {
    expect(normalizeMessageType("order")).toBe("unsupported");
  });
});

describe("extractBody", () => {
  it("reads Meta's nested text body", () => {
    expect(extractBody({ type: "text", text: { body: "Hi" } }, "text")).toBe("Hi");
  });
  it("reads a media caption", () => {
    expect(extractBody({ type: "image", image: { id: "m1", caption: "my passport" } }, "image")).toBe("my passport");
  });
  it("reads a tapped button reply — the taps the keyword gate depends on", () => {
    const msg = { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "1", title: "Interested" } } };
    expect(extractBody(msg, "interactive")).toBe("Interested");
  });
  it("reads a template quick-reply button", () => {
    expect(extractBody({ type: "button", button: { text: "Yes", payload: "YES" } }, "button")).toBe("Yes");
  });
  it("reads a flat relay body", () => {
    expect(extractBody({ message: "call me tomorrow" }, "text")).toBe("call me tomorrow");
  });
  it("is null when a media message carries no caption", () => {
    expect(extractBody({ type: "image", image: { id: "m1" } }, "image")).toBeNull();
  });
});

describe("extractInboundMessages", () => {
  it("pulls a text message out of Meta's native envelope", () => {
    const msgs = extractInboundMessages(
      metaEnvelope([{ from: "919876543210", id: "wamid.ABC", timestamp: "1754308800", type: "text", text: { body: "Hello" } }]),
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      from: "919876543210",
      providerMessageId: "wamid.ABC",
      type: "text",
      body: "Hello",
    });
    expect(msgs[0].occurredAt?.toISOString()).toBe("2025-08-04T12:00:00.000Z");
  });

  it("handles a BATCHED envelope — Meta sends several messages in one POST", () => {
    const msgs = extractInboundMessages(
      metaEnvelope([
        { from: "919876543210", id: "wamid.1", type: "text", text: { body: "one" } },
        { from: "447911123456", id: "wamid.2", type: "text", text: { body: "two" } },
      ]),
    );
    expect(msgs.map((m) => m.body)).toEqual(["one", "two"]);
    expect(msgs.map((m) => m.from)).toEqual(["919876543210", "447911123456"]);
  });

  it("captures media handles so an attachment can be fetched later", () => {
    const [msg] = extractInboundMessages(
      metaEnvelope([
        {
          from: "919876543210",
          id: "wamid.DOC",
          type: "document",
          document: { id: "media-1", mime_type: "application/pdf", filename: "degree.pdf", caption: "my degree" },
        },
      ]),
    );
    expect(msg).toMatchObject({
      type: "document",
      mediaId: "media-1",
      mediaMime: "application/pdf",
      fileName: "degree.pdf",
      body: "my degree",
    });
  });

  it("reads a flat relay body as one message", () => {
    const msgs = extractInboundMessages({ phone: "+91 98765 43210", message: "Interested", lead_id: "lead_1" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ from: "+91 98765 43210", body: "Interested", leadId: "lead_1" });
  });

  it("returns nothing for a STATUS-only batch — those belong to the delivery-status hook", () => {
    const statusBody = {
      entry: [
        { changes: [{ value: { statuses: [{ id: "wamid.X", status: "delivered", recipient_id: "919876543210" }] } }] },
      ],
    };
    expect(extractInboundMessages(statusBody)).toEqual([]);
  });

  it("does not mistake a flat status callback for a message", () => {
    expect(extractInboundMessages({ statuses: [{ status: "read" }] })).toEqual([]);
  });

  // The sibling parser (extractDeliveryEvents) accepts four status shapes; only
  // one of them carries a top-level `statuses` key. The other three reach this
  // parser looking like messages, and mirroring them would put empty bubbles in
  // the thread for data the delivery-status hook already owns.
  it("rejects a FLAT status callback that has no statuses key", () => {
    expect(extractInboundMessages({ phone: "919876543210", status: "delivered" })).toEqual([]);
  });
  it("rejects a status wrapped in `data`", () => {
    expect(extractInboundMessages({ data: { phone: "919876543210", status: "failed", error_code: "131026" } })).toEqual([]);
  });
  it("rejects statuses delivered under a `messages` array", () => {
    expect(extractInboundMessages({ messages: [{ wa_id: "919876543210", message_status: "read" }] })).toEqual([]);
  });
  it("still keeps a real message whose TEXT is the word 'read'", () => {
    const msgs = extractInboundMessages(
      metaEnvelope([{ from: "919876543210", id: "wamid.R", type: "text", text: { body: "read" } }]),
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe("read");
  });

  it("drops a message with no sender — there is no thread to attach it to", () => {
    expect(extractInboundMessages(metaEnvelope([{ id: "wamid.NOFROM", type: "text", text: { body: "orphan" } }]))).toEqual([]);
  });

  it("is empty on junk rather than throwing", () => {
    expect(extractInboundMessages(null)).toEqual([]);
    expect(extractInboundMessages("nope")).toEqual([]);
    expect(extractInboundMessages([])).toEqual([]);
  });
});

describe("session window", () => {
  it("expires 24 hours after the candidate's last message", () => {
    const at = new Date("2026-08-13T09:00:00.000Z");
    expect(sessionExpiryFrom(at).getTime() - at.getTime()).toBe(WA_SESSION_WINDOW_MS);
  });
  it("is open inside the window and closed outside it", () => {
    const now = new Date("2026-08-13T09:00:00.000Z");
    expect(isSessionOpen(new Date("2026-08-13T09:00:01.000Z"), now)).toBe(true);
    expect(isSessionOpen(new Date("2026-08-13T08:59:59.000Z"), now)).toBe(false);
  });
  it("is closed when the candidate has never written", () => {
    expect(isSessionOpen(null)).toBe(false);
  });
});

describe("advanceTimestamps", () => {
  const expiry = new Date("2026-08-14T09:00:00.000Z");

  it("stamps everything on a thread's first message", () => {
    const at = new Date("2026-08-13T09:00:00.000Z");
    expect(advanceTimestamps({ lastMessageAt: null, lastInboundAt: null }, at, expiry)).toEqual({
      lastMessageAt: at,
      lastInboundAt: at,
      sessionExpiresAt: expiry,
    });
  });

  it("moves forward for a newer message", () => {
    const at = new Date("2026-08-13T12:00:00.000Z");
    const patch = advanceTimestamps(
      { lastMessageAt: new Date("2026-08-13T09:00:00.000Z"), lastInboundAt: new Date("2026-08-13T09:00:00.000Z") },
      at,
      expiry,
    );
    expect(patch).toEqual({ lastMessageAt: at, lastInboundAt: at, sessionExpiresAt: expiry });
  });

  it("does NOT rewind for a replayed older message — that would re-open a closed reply window", () => {
    const older = new Date("2026-08-13T06:00:00.000Z");
    const patch = advanceTimestamps(
      { lastMessageAt: new Date("2026-08-13T09:00:00.000Z"), lastInboundAt: new Date("2026-08-13T09:00:00.000Z") },
      older,
      expiry,
    );
    expect(patch).toEqual({});
  });
});
