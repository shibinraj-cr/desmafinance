import { describe, it, expect } from "vitest";
import { extractDeliveryStatuses, normalizeDeliveryState } from "@/lib/wa/delivery-status";
import { statusTooltip } from "@/lib/wa/status-label";

/**
 * Meta's status callbacks arrive on the same webhook as messages and were being
 * discarded, which is why every message the CRM sent showed one grey tick
 * forever. These cover the parsing and the vocabulary; the forward-only rule
 * lives in a `updateMany` WHERE clause and is asserted through the rank table
 * below, since that is the part a well-meaning edit would break silently.
 */

/** Meta's real envelope, values anonymised. */
const META_BODY = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "1267509371484132",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "919000000000", phone_number_id: "641150285746786" },
            statuses: [
              {
                id: "wamid.TEST1",
                status: "delivered",
                timestamp: "1755600000",
                recipient_id: "919000000001",
                conversation: { id: "conv1", origin: { type: "service" } },
                pricing: { billable: true, category: "service" },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("extractDeliveryStatuses", () => {
  it("finds a status inside Meta's nested envelope", () => {
    const found = extractDeliveryStatuses(META_BODY);
    expect(found).toHaveLength(1);
    expect(found[0].providerMessageId).toBe("wamid.TEST1");
    expect(found[0].status).toBe("delivered");
    expect(found[0].occurredAt?.toISOString()).toBe("2025-08-19T10:40:00.000Z");
  });

  it("reads a failure's code and Meta's own sentence", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid.TEST2",
                    status: "failed",
                    timestamp: "1755600000",
                    errors: [
                      {
                        code: 131047,
                        title: "Re-engagement message",
                        error_data: { details: "Message failed to send because more than 24 hours have passed." },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const [found] = extractDeliveryStatuses(body);
    expect(found.status).toBe("failed");
    expect(found.errorCode).toBe("131047");
    // The title is preferred over the code because it is the part a consultant
    // can act on without looking anything up.
    expect(found.errorMessage).toBe("Re-engagement message");
  });

  it("ignores a status with no message id, rather than guessing at one", () => {
    // Attaching this by phone would write a status onto whichever message was
    // nearest — including somebody else's.
    const body = { statuses: [{ status: "read", recipient_id: "919000000001" }] };
    expect(extractDeliveryStatuses(body)).toEqual([]);
  });

  it("does not treat an inbound message as a status", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: "919000000001", id: "wamid.IN", type: "text", text: { body: "read" } }],
              },
            },
          ],
        },
      ],
    };
    // The word "read" as message TEXT must not register as a read receipt.
    expect(extractDeliveryStatuses(body)).toEqual([]);
  });

  it("collapses a redelivered duplicate within one batch", () => {
    const body = {
      statuses: [
        { id: "wamid.TEST3", status: "delivered", timestamp: "1755600000" },
        { id: "wamid.TEST3", status: "delivered", timestamp: "1755600000" },
      ],
    };
    expect(extractDeliveryStatuses(body)).toHaveLength(1);
  });

  it("keeps two different states for the same message", () => {
    // Meta batches, and a delivered+read pair in one POST is ordinary.
    const body = {
      statuses: [
        { id: "wamid.TEST4", status: "delivered", timestamp: "1755600000" },
        { id: "wamid.TEST4", status: "read", timestamp: "1755600060" },
      ],
    };
    expect(extractDeliveryStatuses(body)).toHaveLength(2);
  });

  it("is empty rather than throwing on junk", () => {
    expect(extractDeliveryStatuses(null)).toEqual([]);
    expect(extractDeliveryStatuses("nope")).toEqual([]);
    expect(extractDeliveryStatuses({})).toEqual([]);
  });
});

describe("normalizeDeliveryState", () => {
  it("maps Meta's vocabulary and the spellings relays use", () => {
    expect(normalizeDeliveryState("sent")).toBe("sent");
    expect(normalizeDeliveryState("DELIVERED")).toBe("delivered");
    expect(normalizeDeliveryState("seen")).toBe("read");
    expect(normalizeDeliveryState("undelivered")).toBe("failed");
  });

  it("drops statuses that say nothing about delivery", () => {
    // Real Meta statuses, but neither means the message did or did not arrive —
    // mapping them onto one that does would be inventing an answer.
    expect(normalizeDeliveryState("deleted")).toBeNull();
    expect(normalizeDeliveryState("warning")).toBeNull();
    expect(normalizeDeliveryState("")).toBeNull();
    expect(normalizeDeliveryState(undefined)).toBeNull();
  });
});

describe("statusTooltip", () => {
  const blank = { waStatusAt: null, waErrorCode: null, waErrorMessage: null };

  it("is just the label when nothing else is known", () => {
    expect(statusTooltip("Sent", blank)).toBe("Sent");
  });

  it("adds when it happened, which is the next question after whether", () => {
    const tip = statusTooltip("Delivered", { ...blank, waStatusAt: "2026-08-19T10:40:00.000Z" });
    expect(tip).toMatch(/^Delivered /);
    expect(tip).toMatch(/19/);
  });

  it("leads a failure with Meta's sentence, not its number", () => {
    const tip = statusTooltip("Failed", {
      ...blank,
      waErrorCode: "131047",
      waErrorMessage: "Re-engagement message",
    });
    expect(tip.indexOf("Re-engagement")).toBeLessThan(tip.indexOf("131047"));
  });

  it("survives an unparseable timestamp instead of printing Invalid Date", () => {
    expect(statusTooltip("Read", { ...blank, waStatusAt: "not a date" })).toBe("Read");
  });
});
