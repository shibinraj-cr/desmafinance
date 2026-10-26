import { describe, it, expect, vi, beforeEach } from "vitest";

// sendWaMessage reads the conversation, calls the provider, then records the
// message. Everything it touches is mocked so the test can see exactly what it
// writes back to the conversation and the lead's timeline.
const findUnique = vi.fn();
const update = vi.fn();
const create = vi.fn();
const recordLeadActivity = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    waConversation: { findUnique: (a: unknown) => findUnique(a), update: (a: unknown) => update(a) },
    waMessage: { create: (a: unknown) => create(a) },
  },
}));
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: (a: unknown) => recordLeadActivity(a) }));
vi.mock("@/lib/wa/mirror", () => ({ isSessionOpen: () => true }));
vi.mock("@/lib/wa/registry", () => ({
  getWaProvider: async () => ({
    key: "cloud",
    sendTemplate: async () => ({ ok: true, providerMessageId: "wamid.T" }),
    sendText: async () => ({ ok: true, providerMessageId: "wamid.X" }),
  }),
}));

import { sendWaMessage } from "@/lib/wa/send";

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({ id: "c1", phoneE164: "+919800000000", leadId: "l1", sessionExpiresAt: null });
  update.mockReset().mockResolvedValue({});
  create.mockReset().mockResolvedValue({ id: "m1" });
  recordLeadActivity.mockReset().mockResolvedValue(undefined);
});

describe("sendWaMessage — who answered", () => {
  it("a consultant's send clears awaitingReply and goes on the timeline", async () => {
    const out = await sendWaMessage({ conversationId: "c1", sentById: "u1", body: "Hello" });
    expect(out.ok).toBe(true);
    expect(update.mock.calls[0][0].data.awaitingReply).toBe(false);
    expect(recordLeadActivity).toHaveBeenCalledTimes(1);
    expect(recordLeadActivity.mock.calls[0][0].actorId).toBe("u1");
  });

  it("an automated send (no author) leaves the candidate in Needs reply", async () => {
    const out = await sendWaMessage({ conversationId: "c1", sentById: null, template: "task_reminder:en" });
    expect(out.ok).toBe(true);
    expect(update.mock.calls[0][0].data).not.toHaveProperty("awaitingReply");
    expect(update.mock.calls[0][0].data.lastMessageAt).toBeInstanceOf(Date);
  });

  it("recordActivity: false skips the generic timeline row (the caller writes its own)", async () => {
    await sendWaMessage({ conversationId: "c1", sentById: null, template: "task_reminder:en", recordActivity: false });
    expect(recordLeadActivity).not.toHaveBeenCalled();
  });
});
