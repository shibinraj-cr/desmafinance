import { describe, expect, it } from "vitest";
import { leadSearchClauses } from "@/lib/crm-leads";
import { leadHint, maskEmail, maskPhone } from "@/lib/partner-commissions/lead-hint";

const fields = (q: string) => leadSearchClauses(q).map((c) => Object.keys(c)[0]);

describe("lead search (shared by the Leads list and the enrollment form)", () => {
  it("searches email only when the query has an @", () => {
    expect(leadSearchClauses("asha.k@gmail.com")).toEqual([{ email: { contains: "asha.k@gmail.com", mode: "insensitive" } }]);
  });
  it("finds a phone typed in any format by its bare digits", () => {
    const or = leadSearchClauses("+91 98765 43210");
    expect(or).toContainEqual({ phoneE164: { contains: "919876543210" } });
    expect(or).toContainEqual({ phone: { contains: "919876543210" } });
    expect(or).toContainEqual({ altPhoneE164: { contains: "919876543210" } });
    expect(leadSearchClauses("98765 43210")).toContainEqual({ phoneE164: { contains: "9876543210" } });
  });
  it("searches names (and partial emails) without digit-matching phones for name-like text", () => {
    expect(fields("Asha")).toEqual(["candidateName", "email", "phone", "phoneE164", "altPhone", "altPhoneE164"]);
    expect(leadSearchClauses("asha2")).not.toContainEqual({ phoneE164: { contains: "2" } });
    expect(leadSearchClauses("gmail.com")).toContainEqual({ email: { contains: "gmail.com", mode: "insensitive" } });
  });
});

describe("lead hint masking", () => {
  it("masks email and phone", () => {
    expect(maskEmail("asha.k@gmail.com")).toBe("as***@gmail.com");
    expect(maskEmail("a@x.com")).toBe("a***@x.com");
    expect(maskEmail("not-an-email")).toBeNull();
    expect(maskPhone("+91 98765 43210")).toBe("…3210");
    expect(maskPhone("12")).toBeNull();
  });
  it("falls back to the alternate phone and skips what's missing", () => {
    expect(leadHint({ service: "GCAN", phone: null, altPhone: "9876543210", email: "asha@x.com" })).toBe("GCAN · …3210 · as***@x.com");
    expect(leadHint({ service: null, phone: null, email: null })).toBe("");
  });
});
