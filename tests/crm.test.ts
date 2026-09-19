import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  computeDedupeKey,
  emailKeyOf,
  phoneMatchKeys,
  renderTemplate,
  isOtherQualification,
  qualificationText,
  detailsSilentDays,
} from "@/lib/crm";

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

describe("isOtherQualification", () => {
  it("matches both spellings the master has ever carried, any case", () => {
    expect(isOtherQualification("Others")).toBe(true);
    expect(isOtherQualification("Other")).toBe(true);
    expect(isOtherQualification("others")).toBe(true);
    expect(isOtherQualification("  Other  ")).toBe(true);
  });
  it("does not match a real qualification that merely contains the word", () => {
    expect(isOtherQualification("BSN")).toBe(false);
    expect(isOtherQualification("Other Nursing Degree")).toBe(false);
    expect(isOtherQualification(null)).toBe(false);
    expect(isOtherQualification("")).toBe(false);
  });
});

describe("qualificationText", () => {
  it("folds the free-text detail into the catch-all label", () => {
    expect(qualificationText("Others", "MBA")).toBe("Others (MBA)");
  });
  it("leaves a real qualification alone even if stale detail is present", () => {
    // Belt-and-braces: the API clears the detail on a move off "Others", but a
    // row written before that rule existed must never read as "BSN (MBA)".
    expect(qualificationText("BSN", "MBA")).toBe("BSN");
  });
  it("falls back to the bare label when there is no detail", () => {
    expect(qualificationText("Others", null)).toBe("Others");
    expect(qualificationText("Others", "   ")).toBe("Others");
  });
  it("returns null with no qualification, leaving the caller's blank convention", () => {
    expect(qualificationText(null, "MBA")).toBeNull();
    expect(qualificationText(undefined)).toBeNull();
  });
});

describe("detailsSilentDays", () => {
  const now = new Date("2026-09-19T12:00:00.000Z");

  it("counts whole days since the pitch went out", () => {
    expect(detailsSilentDays("2026-09-12T12:00:00.000Z", null, now)).toBe(7);
  });
  it("floors, so a pitch sent today reads as 0 rather than rounding up", () => {
    expect(detailsSilentDays("2026-09-19T01:00:00.000Z", null, now)).toBe(0);
  });
  it("stops counting once they replied — the clock is silence, not age", () => {
    expect(detailsSilentDays("2026-09-12T12:00:00.000Z", "2026-09-13T09:00:00.000Z", now)).toBeNull();
  });
  it("has nothing to count when no details were sent", () => {
    expect(detailsSilentDays(null, null, now)).toBeNull();
    expect(detailsSilentDays(undefined, undefined, now)).toBeNull();
  });
  it("never goes negative on a clock skew", () => {
    expect(detailsSilentDays("2026-09-20T12:00:00.000Z", null, now)).toBe(0);
  });
});
