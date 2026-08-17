import { describe, it, expect } from "vitest";
import {
  findRecordArray,
  isWabisInternalEvent,
  nextOffsetOf,
  normalizeWabisMessage,
  normalizeWabisStatus,
  parseWabisTime,
  redactSample,
  subscriberName,
  subscriberPhone,
  wabisDirection,
  wabisErrorMessage,
} from "@/lib/wa/wabis-import";

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

  it("reports an unrecognised sender as unknown rather than filing it", () => {
    expect(normalizeWabisMessage({}).direction).toBeNull();
    expect(normalizeWabisMessage({ direction: "something_new" }).direction).toBeNull();
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

// Wabis answers HTTP 200 and signals failure in the body. Without this, a
// rejected request looks exactly like an empty result — which is precisely how
// the first real run reported "0 messages found" and explained nothing.
/**
 * The real record shape, taken verbatim from Wabis's documented Sample Response.
 * Every field my normaliser reads is exercised against it, because the previous
 * version read four fields that do not exist on this record.
 */
const REAL_RECORD: Record<string, unknown> = {
  id: 8003,
  whatsapp_bot_subscriber_subscriber_id: "0123456789-23",
  whatsapp_bot_id: 23,
  sender: "bot",
  agent_name: null,
  message_content:
    '{"messaging_product":"whatsapp","recipient_type":"individual","to":"0123456789","type":"interactive","interactive":{"header":{"type":"text","text":"Order gateway"},"body":{"text":"How would you like to purchase it?"},"type":"button"}}',
  conversation_time: "2024-07-28 13:21:03",
  wa_message_id: "wamid.HBgNODgwMTcyMzMwOTAwMxUCABEYEjlGQkY3MEFEMEVGODhCNDkxNQA=",
  message_status: null,
  failed_reason: "",
};

describe("normalizeWabisMessage against the documented record", () => {
  it("takes the Meta wamid, never Wabis's own row id", () => {
    // `id` in providerMessageId would poison the unique index that makes
    // re-running the import safe.
    const m = normalizeWabisMessage(REAL_RECORD);
    expect(m.providerMessageId).toBe(REAL_RECORD.wa_message_id);
    expect(normalizeWabisMessage({ id: 8003 }).providerMessageId).toBeNull();
  });

  it("reads the type out of the double-encoded message_content", () => {
    expect(normalizeWabisMessage(REAL_RECORD).type).toBe("interactive");
  });

  it("reads the body out of the nested interactive payload", () => {
    expect(normalizeWabisMessage(REAL_RECORD).body).toBe("How would you like to purchase it?");
  });

  it("reads a plain text message's body from text.body", () => {
    const rec = { ...REAL_RECORD, message_content: '{"type":"text","text":{"body":"Hello there"}}' };
    const m = normalizeWabisMessage(rec);
    expect(m.type).toBe("text");
    expect(m.body).toBe("Hello there");
  });

  it("never leaves raw JSON as the message body", () => {
    expect(normalizeWabisMessage(REAL_RECORD).body).not.toContain("messaging_product");
  });

  it("treats sender 'bot' as outbound", () => {
    expect(normalizeWabisMessage(REAL_RECORD).direction).toBe("out");
  });

  it("parses conversation_time as IST, not as the server's zone", () => {
    // 13:21:03 IST is 07:51:03 UTC. Read as UTC it would be 5.5h out and would
    // interleave wrongly with live messages.
    expect(normalizeWabisMessage(REAL_RECORD).occurredAt?.toISOString()).toBe("2024-07-28T07:51:03.000Z");
  });

  it("recovers a Wabis storage URL from inside the encoded content", () => {
    const url = "https://bot-data.s3.ap-southeast-1.wasabisys.com/livechat/2026/8/whatsapp-1/2-1-3.ogg";
    const rec = { ...REAL_RECORD, message_content: `{"type":"audio","audio":{"url":"${url}"}}` };
    expect(normalizeWabisMessage(rec).mediaUrl).toBe(url);
  });
});

/**
 * A REAL record from the account — a template send. Neither Meta's message
 * format nor Wabis's documented sample covers this shape, and it is what the
 * records actually contain: the text lives at components[].text, and there is no
 * top-level `type` at all.
 */
const REAL_TEMPLATE_RECORD: Record<string, unknown> = {
  id: 1302743707,
  whatsapp_bot_subscriber_subscriber_id: "919000000001-145848",
  whatsapp_bot_id: 145848,
  sender: "automation",
  agent_name: null,
  message_content:
    '{"name":"desgro","language":"en_US","category":"MARKETING","components":[{"type":"body","text":"Hello,\\n\\nI am *Test Agent* from *DESMA International*.","example":{"body_text":[["agent","agent_phone"]]}}]}',
  conversation_time: "2026-07-21 17:56:19",
  wa_message_id: "wamid.HBgMOTE5MDAwMDAwMDAxFQIAERgSM0QwMDAwMDAwMDAwMDAwMDAwAA==",
  message_status: "read",
  delivery_status_updated_at: "2026-07-21 17:56:22",
  read_time: "2026-07-21 17:56:29",
  failed_reason: "",
  failed_time: null,
};

describe("normalizeWabisMessage against a REAL template record", () => {
  // Without the components[] path every template send imports with an empty
  // bubble — which is what all 13 messages in the first successful dry run
  // would have done.
  it("finds the body inside components[]", () => {
    expect(normalizeWabisMessage(REAL_TEMPLATE_RECORD).body).toBe(
      "Hello,\n\nI am *Test Agent* from *DESMA International*.",
    );
  });

  it("classifies it as a template, not as plain text", () => {
    expect(normalizeWabisMessage(REAL_TEMPLATE_RECORD).type).toBe("template");
  });

  it("keeps the template name", () => {
    expect(normalizeWabisMessage(REAL_TEMPLATE_RECORD).templateName).toBe("desgro");
  });

  it("reads sender 'automation' as outbound", () => {
    expect(normalizeWabisMessage(REAL_TEMPLATE_RECORD).direction).toBe("out");
  });

  it("carries Meta's delivery state across, so imported threads show real ticks", () => {
    const m = normalizeWabisMessage(REAL_TEMPLATE_RECORD);
    expect(m.waStatus).toBe("read");
    expect(m.readAt?.toISOString()).toBe("2026-07-21T12:26:29.000Z");
  });

  it("takes the wamid, not the numeric row id", () => {
    expect(normalizeWabisMessage(REAL_TEMPLATE_RECORD).providerMessageId).toBe(
      REAL_TEMPLATE_RECORD.wa_message_id,
    );
  });
});

describe("normalizeWabisStatus", () => {
  it("passes through the four states we store", () => {
    for (const s of ["read", "delivered", "sent", "failed"]) expect(normalizeWabisStatus(s)).toBe(s);
  });
  it("maps synonyms", () => {
    expect(normalizeWabisStatus("seen")).toBe("read");
    expect(normalizeWabisStatus("error")).toBe("failed");
  });
  it("is null on nothing recognisable, rather than inventing a state", () => {
    expect(normalizeWabisStatus(null)).toBeNull();
    expect(normalizeWabisStatus("")).toBeNull();
    expect(normalizeWabisStatus("pending_whatever")).toBeNull();
  });
});

describe("wabisDirection", () => {
  it("classifies the outbound markers we know", () => {
    for (const s of ["bot", "agent", "business", "system", "automation"]) {
      expect(wabisDirection({ sender: s })).toBe("out");
    }
  });

  it("treats a named human agent as outbound whatever the sender says", () => {
    expect(wabisDirection({ sender: "unknown_value", agent_name: "Priya" })).toBe("out");
  });

  it("recognises the inbound markers explicitly", () => {
    for (const sender of ["user", "subscriber", "customer", "contact", "client"]) {
      expect(wabisDirection({ sender })).toBe("in");
    }
  });

  // The value set is undocumented, and defaulting was the wrong answer in both
  // directions: this account's history is overwhelmingly ours, so an unknown
  // value defaulted to inbound misfiles our own messages into the candidate's
  // bubble at scale — permanently, since a written row dedupes on re-run. Null
  // means the record is skipped and the value is reported, which one extra line
  // in the map and a re-run can recover.
  it("declines to classify a sender it does not know", () => {
    expect(wabisDirection({ sender: "something_new" })).toBeNull();
    expect(wabisDirection({})).toBeNull();
  });

  it("covers the send channels Wabis never documented", () => {
    for (const sender of ["admin", "livechat", "human", "api", "broadcast", "outbound"]) {
      expect(wabisDirection({ sender })).toBe("out");
    }
  });

  // A PHP/MySQL backend returns 1, not true.
  it("reads a truthy outgoing flag in the shapes a backend actually sends", () => {
    expect(wabisDirection({ is_outgoing: 1 })).toBe("out");
    expect(wabisDirection({ is_outgoing: "1" })).toBe("out");
    expect(wabisDirection({ from_business: "true" })).toBe("out");
  });
});

describe("parseWabisTime", () => {
  it("reads the documented Y-m-d H:i:s format as IST", () => {
    expect(parseWabisTime("2024-07-28 13:21:03")?.toISOString()).toBe("2024-07-28T07:51:03.000Z");
  });
  it("is null on junk rather than an epoch-zero date", () => {
    expect(parseWabisTime(null)).toBeNull();
    expect(parseWabisTime("")).toBeNull();
    expect(parseWabisTime(12345)).toBeNull();
  });

  // A MySQL DATETIME(6) renders fractional seconds, and the exact-length regex
  // sent every one of those to a fallback that read it in the SERVER's zone —
  // so one thread could mix correct rows with rows 5h30m later, and a reply
  // would sort before the message it answered.
  it("reads the same instant however many digits Wabis renders", () => {
    const expected = "2024-07-28T07:51:03.000Z";
    expect(parseWabisTime("2024-07-28 13:21:03.000000")?.toISOString()).toBe(expected);
    expect(parseWabisTime("2024-07-28T13:21:03")?.toISOString()).toBe(expected);
    expect(parseWabisTime("2024-7-28 13:21:03")?.toISOString()).toBe(expected);
    expect(parseWabisTime("2024-07-28 13:21")?.toISOString()).toBe("2024-07-28T07:51:00.000Z");
  });

  it("refuses a zone-less value it cannot place, rather than assuming the server's zone", () => {
    expect(parseWabisTime("28/07/2024 13:21:03")).toBeNull();
    expect(parseWabisTime("Jul 28 2024 13:21")).toBeNull();
  });

  it("still accepts a value that carries its own zone", () => {
    expect(parseWabisTime("2024-07-28T07:51:03Z")?.toISOString()).toBe("2024-07-28T07:51:03.000Z");
    expect(parseWabisTime("2024-07-28T13:21:03+05:30")?.toISOString()).toBe("2024-07-28T07:51:03.000Z");
  });
});

describe("nextOffsetOf", () => {
  // The spec calls offset a page number but returns nextOffset: 101 for limit 10.
  // Following the server's own cursor is correct under either reading.
  it("follows the server's cursor", () => {
    expect(nextOffsetOf({ status: "1", message: [], nextOffset: 101 })).toBe(101);
    expect(nextOffsetOf({ next_offset: "51" })).toBe(51);
  });
  it("is null when absent or unusable, so the caller falls back", () => {
    expect(nextOffsetOf({ status: "1" })).toBeNull();
    expect(nextOffsetOf({ nextOffset: 0 })).toBeNull();
    expect(nextOffsetOf(null)).toBeNull();
  });
});

describe("findRecordArray on the real envelope", () => {
  it("finds the records under Wabis's `message` key", () => {
    expect(findRecordArray({ status: "1", message: [REAL_RECORD], nextOffset: 101 })).toHaveLength(1);
  });
});

describe("wabisErrorMessage", () => {
  // `message` is an ARRAY on success and a STRING on failure — same key, two
  // types — so status has to be checked before the body is touched.
  it("handles `message` being a string on the failure path", () => {
    expect(wabisErrorMessage({ status: "0", message: "WhatsApp account not found." })).toBe(
      "WhatsApp account not found.",
    );
  });

  it("detects Wabis's in-body failure and returns its message", () => {
    expect(wabisErrorMessage({ status: "0", message: "Invalid phone number" })).toBe("Invalid phone number");
    expect(wabisErrorMessage({ status: 0, error: "bad token" })).toBe("bad token");
    expect(wabisErrorMessage({ success: false, message: "nope" })).toBe("nope");
  });

  it("still reports a failure that carries no message", () => {
    expect(wabisErrorMessage({ status: "0" })).toBe("request rejected (no message given)");
  });

  it("is null on success, so a real empty result is not mistaken for an error", () => {
    expect(wabisErrorMessage({ status: "1", data: [] })).toBeNull();
    expect(wabisErrorMessage({ data: [] })).toBeNull();
    expect(wabisErrorMessage(null)).toBeNull();
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

/**
 * The subscriber record, whose real shape only became visible once the listing
 * endpoint was coaxed into answering. The number is under `chat_id`, which none
 * of the phone-shaped guesses covered, so every contact was skipped as "no
 * usable number" and the account read as empty rather than as mis-mapped.
 *
 * Values below are fabricated behind real country-code prefixes — the repo is
 * public, and a fixture is a poor reason to publish somebody's number.
 */
describe("subscriberPhone", () => {
  const record = {
    subscriber_id: 78410976,
    chat_id: "919000000001",
    first_name: "Test Contact",
    last_name: "",
    email: null,
    gender: null,
    assigned_agent_id: null,
    unseen_count: 0,
    last_message_time: "2025-06-27 07:51:04",
    custom_fields: null,
  };

  it("reads the number Wabis actually sends", () => {
    expect(subscriberPhone(record)).toBe("919000000001");
  });

  it("still reads the phone-shaped names, in case they appear for some subscriber", () => {
    expect(subscriberPhone({ phone_number: "919000000001" })).toBe("919000000001");
    expect(subscriberPhone({ wa_id: "919000000001" })).toBe("919000000001");
  });

  it("prefers chat_id over the guesses when both are present", () => {
    expect(subscriberPhone({ chat_id: "919000000001", phone: "919000000002" })).toBe("919000000001");
  });

  it("reports nothing rather than a blank when no field carries a number", () => {
    expect(subscriberPhone({ subscriber_id: 1, first_name: "Test" })).toBeNull();
  });
});

describe("subscriberName", () => {
  it("takes the name Wabis knows, so imported threads are not a wall of digits", () => {
    expect(subscriberName({ first_name: "Test Contact", last_name: "" })).toBe("Test Contact");
    expect(subscriberName({ first_name: "Test", last_name: "Contact" })).toBe("Test Contact");
  });

  // Some panels fill the name field with the number. Storing that would look
  // like a name while telling nobody anything.
  it("rejects a name that is only the number again", () => {
    expect(subscriberName({ first_name: "919000000001" })).toBeNull();
    expect(subscriberName({ first_name: "+919000000001" })).toBeNull();
  });

  it("is null when there is no name at all", () => {
    expect(subscriberName({ first_name: "", last_name: "" })).toBeNull();
    expect(subscriberName({ chat_id: "919000000001" })).toBeNull();
  });
});

/**
 * `/get/conversation` returns the Wabis panel's own activity log interleaved
 * with the conversation. The first real read of this account produced a "Label
 * added" row, which would have imported as an outbound chat bubble.
 */
describe("isWabisInternalEvent", () => {
  it("recognises a panel event — prose body, no wamid", () => {
    expect(
      isWabisInternalEvent({
        sender: "system",
        agent_name: "bot",
        message_content: "Label added: Meta Leads",
        wa_message_id: null,
      }),
    ).toBe(true);
  });

  it("leaves a real message alone even when it carries no wamid", () => {
    // Both conditions are required. A failed send has no wamid but still holds
    // Meta's payload, and it IS a message we tried to deliver.
    expect(
      isWabisInternalEvent({
        sender: "bot",
        message_content: '{"type":"text","text":{"body":"Hello there"}}',
        wa_message_id: null,
      }),
    ).toBe(false);
  });

  it("leaves anything carrying a wamid alone", () => {
    expect(
      isWabisInternalEvent({ sender: "system", message_content: "Label added", wa_message_id: "wamid.A" }),
    ).toBe(false);
  });

  it("does not treat an empty record as an event", () => {
    expect(isWabisInternalEvent({})).toBe(false);
    expect(isWabisInternalEvent({ message_content: "" })).toBe(false);
  });
});

describe("wabisDirection on the values this account actually produced", () => {
  // Found by the first successful read: a Wabis drip step, which the importer
  // skipped as unrecognised until it was named — the mechanism working.
  it("treats a sequence step as ours", () => {
    expect(wabisDirection({ sender: "sequence" })).toBe("out");
  });

  it("treats the panel's own automation rows as ours", () => {
    expect(wabisDirection({ sender: "system" })).toBe("out");
    expect(wabisDirection({ sender: "automation" })).toBe("out");
  });
});
