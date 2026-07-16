import { describe, it, expect } from "vitest";
import { normalizePhone, computeDedupeKey, emailKeyOf, phoneMatchKeys, renderTemplate } from "@/lib/crm";

describe("normalizePhone", () => {
  it("prefixes +91 for bare 10-digit Indian mobiles", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
  });
  it("strips spaces/dashes/parens before normalising", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("987-654-3210")).toBe("+919876543210");
  });
  it("drops a domestic trunk leading 0", () => {
    expect(normalizePhone("09876543210")).toBe("+919876543210");
  });
  it("keeps an existing 91 country code", () => {
    expect(normalizePhone("919876543210")).toBe("+919876543210");
  });
  it("preserves an explicit international + number", () => {
    expect(normalizePhone("+44 7911 123456")).toBe("+447911123456");
  });
  it("collapses leading-zero access codes so they match the country-coded form", () => {
    // A caller dialled with 00/000… must match the same number the CRM stored
    // with a country code or bare — every variant → one canonical E.164.
    const canonicalQatar = "+97450361786";
    expect(normalizePhone("0097450361786")).toBe(canonicalQatar); // 00 access code
    expect(normalizePhone("00097450361786")).toBe(canonicalQatar); // 000 access code
    expect(normalizePhone("97450361786")).toBe(canonicalQatar); // bare country code
    expect(normalizePhone("+974 5036 1786")).toBe(canonicalQatar); // explicit +
    // An Indian number stored as +91… matches a Voxbay call with leading zeros.
    const canonicalIndia = "+919876543210";
    expect(normalizePhone("919876543210")).toBe(canonicalIndia); // country code
    expect(normalizePhone("00919876543210")).toBe(canonicalIndia); // 00 + country code
    expect(normalizePhone("09876543210")).toBe(canonicalIndia); // single trunk 0
    expect(normalizePhone("9876543210")).toBe(canonicalIndia); // bare 10-digit
  });
  it("returns null for empty / unusable input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("computeDedupeKey", () => {
  it("prefers the lowercased email", () => {
    expect(computeDedupeKey("  Foo@Bar.COM ", "+919876543210")).toBe("foo@bar.com");
  });
  it("falls back to the E.164 phone when no email", () => {
    expect(computeDedupeKey(null, "+919876543210")).toBe("+919876543210");
    expect(computeDedupeKey("", "+919876543210")).toBe("+919876543210");
  });
  it("returns null when neither is present", () => {
    expect(computeDedupeKey(null, null)).toBeNull();
    expect(computeDedupeKey("", "")).toBeNull();
  });
});

describe("emailKeyOf", () => {
  it("lowercases and trims the email", () => {
    expect(emailKeyOf("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
  it("returns null for blank / missing input", () => {
    expect(emailKeyOf(null)).toBeNull();
    expect(emailKeyOf(undefined)).toBeNull();
    expect(emailKeyOf("")).toBeNull();
    expect(emailKeyOf("   ")).toBeNull();
  });
  it("is independent of the phone (unlike computeDedupeKey)", () => {
    // A lead with only a phone has no email key — it is matched on phoneE164.
    expect(emailKeyOf(null)).toBeNull();
    expect(computeDedupeKey(null, "+919876543210")).toBe("+919876543210");
  });
});

describe("phoneMatchKeys", () => {
  it("returns the primary then the alternate number", () => {
    expect(phoneMatchKeys("+919876543210", "+919812345678")).toEqual(["+919876543210", "+919812345678"]);
  });
  it("drops blanks/nulls", () => {
    expect(phoneMatchKeys("+919876543210", null)).toEqual(["+919876543210"]);
    expect(phoneMatchKeys(null, "+919812345678")).toEqual(["+919812345678"]);
    expect(phoneMatchKeys(null, null)).toEqual([]);
    expect(phoneMatchKeys(undefined, undefined)).toEqual([]);
  });
  it("de-duplicates when primary and alternate are the same number", () => {
    expect(phoneMatchKeys("+919876543210", "+919876543210")).toEqual(["+919876543210"]);
  });
});

describe("renderTemplate", () => {
  it("substitutes merge fields", () => {
    expect(
      renderTemplate("Hi {name}, about {service} — {consultant}", {
        name: "Asha",
        service: "Australia PR",
        consultant: "Ravi",
      }),
    ).toBe("Hi Asha, about Australia PR — Ravi");
  });
  it("replaces missing vars with empty strings", () => {
    expect(renderTemplate("Hi {name} {service}", { name: "Asha" })).toBe("Hi Asha ");
  });
  it("replaces all occurrences of a field", () => {
    expect(renderTemplate("{name} {name}", { name: "X" })).toBe("X X");
  });
});
