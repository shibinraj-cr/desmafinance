import { describe, it, expect } from "vitest";
import {
  extractTemplateStatusUpdates,
  isEditableAtMeta,
  isSendable,
  normalizeTemplateStatus,
  rejectionReasonLabel,
} from "@/lib/wa/template-status";

describe("statuses", () => {
  it("reads Meta's vocabulary", () => {
    expect(normalizeTemplateStatus("APPROVED")).toBe("APPROVED");
    expect(normalizeTemplateStatus("pending")).toBe("PENDING");
  });

  it("folds FLAGGED onto PAUSED — the webhook and the catalogue name one condition twice", () => {
    expect(normalizeTemplateStatus("FLAGGED")).toBe("PAUSED");
  });

  it("does not pretend to recognise a status it has never seen", () => {
    expect(normalizeTemplateStatus("SOMETHING_NEW")).toBe("UNKNOWN");
    expect(normalizeTemplateStatus(null)).toBe("UNKNOWN");
  });

  it("only lets an approved template be sent", () => {
    expect(isSendable("APPROVED")).toBe(true);
    for (const s of ["PENDING", "REJECTED", "PAUSED", "DRAFT", "DISABLED"] as const) {
      expect(isSendable(s)).toBe(false);
    }
  });

  it("knows Meta freezes a template while it is under review", () => {
    expect(isEditableAtMeta("PENDING")).toBe(false);
    expect(isEditableAtMeta("APPROVED")).toBe(true);
    expect(isEditableAtMeta("REJECTED")).toBe(true);
    expect(isEditableAtMeta("PAUSED")).toBe(true);
  });
});

describe("rejection reasons", () => {
  it("says what the code means, since the code alone tells an author nothing", () => {
    expect(rejectionReasonLabel("INCORRECT_CATEGORY")).toMatch(/category/i);
  });

  it("treats NONE as no reason at all", () => {
    expect(rejectionReasonLabel("NONE")).toBeNull();
    expect(rejectionReasonLabel(null)).toBeNull();
  });

  it("shows a code it cannot explain rather than swallowing it", () => {
    expect(rejectionReasonLabel("SOME_NEW_CODE")).toBe("some new code");
  });
});

describe("the status webhook", () => {
  it("pulls an approval out of Meta's envelope", () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: 1234567890,
                message_template_name: "follow_up",
                message_template_language: "en",
                reason: "NONE",
              },
            },
          ],
        },
      ],
    };

    expect(extractTemplateStatusUpdates(body)).toEqual([
      {
        metaId: "1234567890",
        name: "follow_up",
        language: "en",
        status: "APPROVED",
        reason: null,
        newCategory: null,
      },
    ]);
  });

  it("keeps the reason on a rejection", () => {
    const [update] = extractTemplateStatusUpdates({
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: { event: "REJECTED", message_template_id: 7, reason: "INCORRECT_CATEGORY" },
            },
          ],
        },
      ],
    });
    expect(update.status).toBe("REJECTED");
    expect(update.reason).toBe("INCORRECT_CATEGORY");
  });

  it("reads a recategorisation without claiming to know the approval status", () => {
    const [update] = extractTemplateStatusUpdates({
      entry: [
        {
          changes: [
            {
              field: "template_category_update",
              value: {
                message_template_id: 9,
                message_template_name: "offer",
                message_template_language: "en",
                previous_category: "UTILITY",
                new_category: "MARKETING",
              },
            },
          ],
        },
      ],
    });
    expect(update.newCategory).toBe("MARKETING");
    expect(update.status).toBe("UNKNOWN");
  });

  it("ignores the messages and delivery statuses sharing the same subscription", () => {
    const body = {
      entry: [
        {
          changes: [
            { field: "messages", value: { messages: [{ id: "wamid.x", from: "919000000000" }] } },
            { field: "messages", value: { statuses: [{ id: "wamid.x", status: "delivered" }] } },
          ],
        },
      ],
    };
    expect(extractTemplateStatusUpdates(body)).toEqual([]);
  });

  it("returns nothing for a body it cannot read, rather than throwing on the webhook path", () => {
    expect(extractTemplateStatusUpdates(null)).toEqual([]);
    expect(extractTemplateStatusUpdates("nonsense")).toEqual([]);
    expect(extractTemplateStatusUpdates({ entry: "not-an-array" })).toEqual([]);
  });
});
