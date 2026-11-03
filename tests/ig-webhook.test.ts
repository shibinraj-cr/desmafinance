import { describe, it, expect } from "vitest";
import { extractIgEvents, parseIgTimestamp } from "@/lib/ig/webhook";

const ACCOUNT = "17841400000000001";
const CANDIDATE = "620000000000001";
const T = 1793000000000; // Nov 2026, epoch ms

function envelope(messaging: unknown[], extra: Record<string, unknown> = {}) {
  return { object: "instagram", entry: [{ id: ACCOUNT, time: T, messaging, ...extra }] };
}

describe("parseIgTimestamp", () => {
  it("reads epoch milliseconds and seconds", () => {
    expect(parseIgTimestamp(T, new Date(T))?.getTime()).toBe(T);
    expect(parseIgTimestamp(T / 1000, new Date(T))?.getTime()).toBe(T);
  });
  it("rejects nonsense rather than sorting it to the end of a thread", () => {
    expect(parseIgTimestamp(0)).toBeNull();
    expect(parseIgTimestamp("abc")).toBeNull();
    expect(parseIgTimestamp(T + 10 * 24 * 3600 * 1000, new Date(T))).toBeNull();
  });
});

describe("extractIgEvents", () => {
  it("reads a candidate's text message", () => {
    const [ev] = extractIgEvents(
      envelope([{ sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T, message: { mid: "m1", text: "hi" } }]),
    );
    expect(ev).toMatchObject({ kind: "in", igsid: CANDIDATE, accountId: ACCOUNT, mid: "m1", text: "hi", standby: false });
    expect(ev.occurredAt?.getTime()).toBe(T);
  });

  it("keys an echo on the candidate, not on us", () => {
    const [ev] = extractIgEvents(
      envelope([{ sender: { id: ACCOUNT }, recipient: { id: CANDIDATE }, timestamp: T, message: { mid: "m2", text: "hello", is_echo: true } }]),
    );
    expect(ev).toMatchObject({ kind: "echo", igsid: CANDIDATE, text: "hello" });
  });

  it("treats a message sent BY our account as an echo even without the flag", () => {
    const [ev] = extractIgEvents(
      envelope([{ sender: { id: ACCOUNT }, recipient: { id: CANDIDATE }, timestamp: T, message: { mid: "m3", text: "x" } }]),
    );
    expect(ev.kind).toBe("echo");
    expect(ev.igsid).toBe(CANDIDATE);
  });

  it("carries a tapped quick reply's payload", () => {
    const [ev] = extractIgEvents(
      envelope([
        {
          sender: { id: CANDIDATE },
          recipient: { id: ACCOUNT },
          timestamp: T,
          message: { mid: "m4", text: "GNM", quick_reply: { payload: "desgro_qual:q_gnm" } },
        },
      ]),
    );
    expect(ev.quickReplyPayload).toBe("desgro_qual:q_gnm");
  });

  it("reads a postback as the candidate saying its title", () => {
    const [ev] = extractIgEvents(
      envelope([{ sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T, postback: { mid: "m5", title: "Fees?", payload: "FEES" } }]),
    );
    expect(ev).toMatchObject({ kind: "in", text: "Fees?", quickReplyPayload: "FEES" });
  });

  it("flags messages that arrive on standby", () => {
    const events = extractIgEvents(
      envelope([], {
        standby: [{ sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T, message: { mid: "m6", text: "hi" } }],
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].standby).toBe(true);
  });

  it("notes the attachment type when there is no text", () => {
    const [img] = extractIgEvents(
      envelope([
        { sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T, message: { mid: "m7", attachments: [{ type: "image", payload: { url: "https://x" } }] } },
      ]),
    );
    expect(img).toMatchObject({ text: null, attachmentType: "image" });
    const [odd] = extractIgEvents(
      envelope([{ sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T, message: { mid: "m8", is_unsupported: true } }]),
    );
    expect(odd.attachmentType).toBe("unsupported");
  });

  it("drops deletions, reads and reactions", () => {
    expect(
      extractIgEvents(
        envelope([
          { sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T, message: { mid: "m9", is_deleted: true } },
          { sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T, read: { mid: "m1" } },
          { sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T, reaction: { mid: "m1", action: "react" } },
        ]),
      ),
    ).toEqual([]);
  });

  it("ignores other webhook objects and junk", () => {
    expect(extractIgEvents({ object: "page", entry: [] })).toEqual([]);
    expect(extractIgEvents(null)).toEqual([]);
    expect(extractIgEvents("nope")).toEqual([]);
  });

  it("returns a batch in the order it happened", () => {
    const events = extractIgEvents(
      envelope([
        { sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T + 2000, message: { mid: "b", text: "9876543210" } },
        { sender: { id: CANDIDATE }, recipient: { id: ACCOUNT }, timestamp: T, message: { mid: "a", text: "hi" } },
      ]),
    );
    expect(events.map((e) => e.mid)).toEqual(["a", "b"]);
  });
});
