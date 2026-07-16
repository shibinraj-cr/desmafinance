import { describe, it, expect } from "vitest";
import { subscriptionStatus } from "@/lib/etimeoffice-subscription";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("subscriptionStatus", () => {
  it("returns 'none' when no expiry is set", () => {
    const s = subscriptionStatus(null, d("2026-07-16"));
    expect(s.tone).toBe("none");
    expect(s.daysLeft).toBeNull();
    expect(s.expiry).toBeNull();
  });

  it("counts days left for a far-off renewal (ok tone)", () => {
    // 08 Feb 2027 from 16 Jul 2026 = 207 days (matches the portal's countdown).
    const s = subscriptionStatus(d("2027-02-08"), d("2026-07-16"));
    expect(s.daysLeft).toBe(207);
    expect(s.tone).toBe("ok");
    expect(s.expiry).toBe("2027-02-08");
  });

  it("turns 'warn' within the 7-day banner window", () => {
    expect(subscriptionStatus(d("2027-02-08"), d("2027-02-02")).tone).toBe("warn"); // 6 days
    expect(subscriptionStatus(d("2027-02-08"), d("2027-02-01")).daysLeft).toBe(7);
    expect(subscriptionStatus(d("2027-02-08"), d("2027-02-01")).tone).toBe("warn"); // exactly 7
    expect(subscriptionStatus(d("2027-02-08"), d("2027-01-31")).tone).toBe("ok"); // 8 days → ok
  });

  it("is 'warn' on the last day and 'expired' after", () => {
    expect(subscriptionStatus(d("2027-02-08"), d("2027-02-08")).daysLeft).toBe(0);
    expect(subscriptionStatus(d("2027-02-08"), d("2027-02-08")).tone).toBe("warn");
    const expired = subscriptionStatus(d("2027-02-08"), d("2027-02-11"));
    expect(expired.tone).toBe("expired");
    expect(expired.daysLeft).toBe(-3);
    expect(expired.label).toContain("expired");
  });
});
