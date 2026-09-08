import { describe, it, expect, vi, beforeEach } from "vitest";

const settings = new Map<string, string>();

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/app-settings", () => ({
  getSetting: async (k: string) => settings.get(k) ?? null,
  setSetting: async (k: string, v: string) => void settings.set(k, v),
}));

const shared = {
  user: "info@desma.in",
  pass: "shared-pass",
  fromName: "DESMA International",
  fromAddress: "info@desma.in",
  replyTo: null,
  dailyCap: 450,
};
let sharedConfig: typeof shared | null = shared;

vi.mock("@/lib/mailer", () => ({
  getEmailConfig: async () => sharedConfig,
  DEFAULT_DAILY_CAP: 450,
}));

const { getHiringEmailConfig } = await import("@/lib/hiring/email");

beforeEach(() => {
  settings.clear();
  sharedConfig = shared;
});

describe("getHiringEmailConfig", () => {
  it("falls back to the shared account when hiring sets nothing", async () => {
    const cfg = await getHiringEmailConfig();
    expect(cfg?.user).toBe("info@desma.in");
    expect(cfg?.fromAddress).toBe("info@desma.in");
  });

  it("relabels shared-account mail when only a From address is set", async () => {
    settings.set("hiring_email_from_address", "hr@desma.in");
    const cfg = await getHiringEmailConfig();
    // Still authenticating as info@ — this is the case Google may rewrite.
    expect(cfg?.user).toBe("info@desma.in");
    expect(cfg?.fromAddress).toBe("hr@desma.in");
    // Which is exactly why Reply-To is set regardless.
    expect(cfg?.replyTo).toBe("hr@desma.in");
  });

  it("signs in as the hiring mailbox when one is configured", async () => {
    settings.set("hiring_email_smtp_user", "hr@desma.in");
    settings.set("hiring_email_smtp_pass", "abcdefghijklmnop");
    const cfg = await getHiringEmailConfig();
    expect(cfg?.user).toBe("hr@desma.in");
    expect(cfg?.pass).toBe("abcdefghijklmnop");
    // No override needed: mail genuinely originates from that mailbox.
    expect(cfg?.fromAddress).toBe("hr@desma.in");
  });

  it("still honours a display From when hiring has its own mailbox", async () => {
    settings.set("hiring_email_smtp_user", "hr@desma.in");
    settings.set("hiring_email_smtp_pass", "pw");
    settings.set("hiring_email_from_address", "careers@desma.in");
    const cfg = await getHiringEmailConfig();
    expect(cfg?.user).toBe("hr@desma.in");
    expect(cfg?.fromAddress).toBe("careers@desma.in");
  });

  it("works with no shared account at all", async () => {
    sharedConfig = null;
    settings.set("hiring_email_smtp_user", "hr@desma.in");
    settings.set("hiring_email_smtp_pass", "pw");
    const cfg = await getHiringEmailConfig();
    expect(cfg?.user).toBe("hr@desma.in");
    expect(cfg?.dailyCap).toBe(450);
  });

  it("ignores a half-configured mailbox rather than failing to authenticate", async () => {
    settings.set("hiring_email_smtp_user", "hr@desma.in");
    const cfg = await getHiringEmailConfig();
    expect(cfg?.user).toBe("info@desma.in");
  });

  it("is null when nothing is configured anywhere", async () => {
    sharedConfig = null;
    expect(await getHiringEmailConfig()).toBeNull();
  });
});
