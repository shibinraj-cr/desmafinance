/**
 * The bell for re-inquiries: who hears about one, and what it says. Prisma is
 * mocked; src/lib/crm-notify.ts runs for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findFirst: vi.fn() },
  crmNotification: { createMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { buildReInquiryNotification, notifyReInquiry } from "@/lib/crm-notify";

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findMany.mockResolvedValue([{ id: "admin1" }, { id: "admin2" }]);
  db.user.findFirst.mockResolvedValue({ id: "bde1" });
  db.crmNotification.createMany.mockResolvedValue({ count: 0 });
});

const sent = () => db.crmNotification.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;

describe("buildReInquiryNotification", () => {
  it("words it for the owner or the Marketing Admin, naming the source", () => {
    const p = { candidateName: "Sample Lead", source: "Voxbay call", revived: false, owned: true };
    expect(buildReInquiryNotification(p, true)).toEqual({ title: "Your lead enquired again", body: "Sample Lead enquired again via Voxbay call." });
    expect(buildReInquiryNotification(p, false).title).toBe("Re-inquiry");
  });
  it("prefers the campaign, and says when the lead was re-opened or has no owner", () => {
    const body = buildReInquiryNotification(
      { candidateName: "Sample Lead", source: "Meta", campaign: "GCC Nurses", revived: true, owned: false },
      false,
    ).body;
    expect(body).toBe("Sample Lead enquired again via GCC Nurses. Re-opened to Re-marketing. Nobody owns this lead — assign a consultant.");
  });
});

describe("notifyReInquiry", () => {
  const base = { leadId: "lead1", candidateName: "Sample Lead", ownerId: "bde1", source: "Meta", revived: false };

  it("rings the owner and every Marketing Admin, linking to the lead", async () => {
    await notifyReInquiry(base);
    expect(sent().map((n) => n.userId)).toEqual(["bde1", "admin1", "admin2"]);
    expect(sent()[0]).toMatchObject({ kind: "re_inquiry", title: "Your lead enquired again", linkUrl: "/crm/leads/lead1", leadId: "lead1" });
    expect(sent()[1]).toMatchObject({ title: "Re-inquiry" });
  });

  it("sends one notification to an owner who is also a Marketing Admin, and none to the person who triggered it", async () => {
    db.user.findMany.mockResolvedValue([{ id: "bde1" }, { id: "admin1" }]);
    await notifyReInquiry({ ...base, actorId: "admin1" });
    expect(sent().map((n) => n.userId)).toEqual(["bde1"]);
    expect(sent()[0].title).toBe("Your lead enquired again");
  });

  it("uses the batch's Marketing Admin list when given, and skips an inactive owner", async () => {
    db.user.findFirst.mockResolvedValue(null);
    await notifyReInquiry({ ...base, marketingAdminIds: ["admin9"] });
    expect(db.user.findMany).not.toHaveBeenCalled();
    expect(sent().map((n) => n.userId)).toEqual(["admin9"]);
  });

  it("tells the Marketing Admin when nobody owns the lead", async () => {
    await notifyReInquiry({ ...base, ownerId: null });
    expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(sent().map((n) => n.userId)).toEqual(["admin1", "admin2"]);
    expect(String(sent()[0].body)).toContain("Nobody owns this lead");
  });

  it("never throws", async () => {
    db.crmNotification.createMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(notifyReInquiry(base)).resolves.toBeUndefined();
  });
});
