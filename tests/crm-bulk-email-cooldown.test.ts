/**
 * The bulk-email cooldown as the route enforces it: one email per address per
 * BULK_EMAIL_COOLDOWN_DAYS. Prisma and SMTP are mocked; the route, and the
 * address matching in the mailer, run for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  lead: { findMany: vi.fn(), updateMany: vi.fn() },
  leadActivity: { create: vi.fn() },
  $queryRaw: vi.fn(),
}));
const send = vi.hoisted(() => vi.fn());
const quota = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({ userId: "admin1", perms: { isAdmin: true } })),
}));
vi.mock("@/lib/crm-rbac", () => ({
  getCrmAccess: vi.fn(async () => ({ canBulkEmail: true })),
}));
vi.mock("@/lib/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mailer")>()),
  getEmailConfig: vi.fn(async () => ({ user: "team@x.com", pass: "p", fromName: null, fromAddress: "team@x.com", replyTo: null, dailyCap: 2000 })),
  getDailyQuota: quota,
  sendEmail: send,
}));

import { POST } from "@/app/api/crm/leads/bulk-email/route";
import { BULK_EMAIL_COOLDOWN_DAYS } from "@/lib/crm";
import { recentlyEmailedAddresses } from "@/lib/mailer";

const lead = (id: string, email: string | null) => ({
  id,
  candidateName: "Test Candidate",
  email,
  campaign: null,
  service: null,
  qualification: null,
  qualificationOther: null,
  assignedTo: null,
});

function run(leads: ReturnType<typeof lead>[]) {
  db.lead.findMany.mockResolvedValue(leads);
  return POST(
    new Request("http://x/api", {
      method: "POST",
      body: JSON.stringify({ leadIds: leads.map((l) => l.id), subject: "Hello", body: "Hi {first_name}" }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  quota.mockResolvedValue({ used: 0, cap: 2000, remaining: 2000 });
  db.$queryRaw.mockResolvedValue([]);
  send.mockResolvedValue({ messageId: "m1" });
});

describe("bulk-email cooldown", () => {
  it("skips an address emailed recently and sends the rest", async () => {
    db.$queryRaw.mockResolvedValue([{ email: "old@x.com" }]);
    const res = await run([lead("a", "old@x.com"), lead("b", "new@x.com")]);
    const d = await res.json();
    expect(d).toMatchObject({ sent: 1, skippedRecent: 1, skippedCap: 0, capReached: false });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1].to).toBe("new@x.com");
    expect(db.leadActivity.create).toHaveBeenCalledTimes(1);
  });

  it("treats a differently-cased address as the same inbox", async () => {
    db.$queryRaw.mockResolvedValue([{ email: "old@x.com" }]);
    const d = await (await run([lead("a", " Old@X.com ")])).json();
    expect(d).toMatchObject({ sent: 0, skippedRecent: 1 });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends once when two leads in a batch share an inbox", async () => {
    const d = await (await run([lead("a", "same@x.com"), lead("b", "SAME@x.com")])).json();
    expect(d).toMatchObject({ sent: 1, skippedRecent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("lets a lead sharing an inbox still receive it when the first send failed", async () => {
    send.mockRejectedValueOnce({ responseCode: 550, message: "mailbox unavailable" });
    const d = await (await run([lead("a", "same@x.com"), lead("b", "same@x.com")])).json();
    expect(d).toMatchObject({ sent: 1, failed: 1, skippedRecent: 0 });
  });

  it("spends no daily quota on a skipped lead", async () => {
    quota.mockResolvedValue({ used: 1999, cap: 2000, remaining: 1 });
    db.$queryRaw.mockResolvedValue([{ email: "old@x.com" }]);
    const d = await (await run([lead("a", "old@x.com"), lead("b", "new@x.com")])).json();
    expect(d).toMatchObject({ sent: 1, skippedRecent: 1, skippedCap: 0 });
    expect(send.mock.calls[0][1].to).toBe("new@x.com");
  });

  it("counts a lead with no address as no-email, not as a cooldown skip", async () => {
    const d = await (await run([lead("a", null), lead("b", ""), lead("c", "   ")])).json();
    expect(d).toMatchObject({ sent: 0, skippedNoEmail: 3, skippedRecent: 0 });
  });
});

describe("recentlyEmailedAddresses", () => {
  it("skips the query when there is nothing to check", async () => {
    expect(await recentlyEmailedAddresses([null, "  "])).toEqual(new Set());
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it("looks up each normalised address once, over the cooldown window", async () => {
    db.$queryRaw.mockResolvedValue([{ email: "a@x.com" }]);
    const before = Date.now();
    const out = await recentlyEmailedAddresses(["A@x.com", " a@x.com", "b@x.com"]);
    expect(out).toEqual(new Set(["a@x.com"]));

    const values = db.$queryRaw.mock.calls[0][0].values as unknown[];
    expect(values.filter((v) => typeof v === "string")).toEqual(["a@x.com", "b@x.com"]);
    const since = (values.find((v) => v instanceof Date) as Date).getTime();
    expect(before - since).toBeGreaterThanOrEqual(BULK_EMAIL_COOLDOWN_DAYS * 86_400_000 - 1000);
    expect(before - since).toBeLessThanOrEqual(BULK_EMAIL_COOLDOWN_DAYS * 86_400_000 + 1000);
  });

  it("compares in UTC, so a non-UTC database session can't shift the window", async () => {
    await recentlyEmailedAddresses(["a@x.com"]);
    expect(db.$queryRaw.mock.calls[0][0].sql).toContain("AT TIME ZONE 'UTC'");
  });
});
