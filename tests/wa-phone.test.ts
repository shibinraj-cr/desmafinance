import { describe, it, expect } from "vitest";
import { waIdToE164, typedPhoneToE164 } from "@/lib/wa/phone";
import { normalizePhone } from "@/lib/crm";

/**
 * A wa_id is already a complete international number, and reading it through the
 * CRM's domestic-default normaliser silently rewrote whole countries into India.
 * These are the guard against that returning — on the live webhook path as much
 * as on the one-off import, since both identify a person by wa_id.
 *
 * Numbers are fabricated behind real country-code prefixes. The repo is public
 * and a fixture is a poor reason to publish somebody's number.
 */

describe("waIdToE164", () => {
  it("takes a wa_id as the complete international number it already is", () => {
    expect(waIdToE164("919000000001")).toBe("+919000000001"); // India
    expect(waIdToE164("353890000000")).toBe("+353890000000"); // Ireland
    expect(waIdToE164("447300000000")).toBe("+447300000000"); // UK
    expect(waIdToE164("35670000000")).toBe("+35670000000"); // Malta
    expect(waIdToE164("971550000000")).toBe("+971550000000"); // UAE
    expect(waIdToE164("966500000000")).toBe("+966500000000"); // Saudi
  });

  it("does NOT invent an Indian country code for a ten-digit foreign number", () => {
    // Singapore: +65 and eight digits is exactly ten, and the CRM's own
    // normalizePhone would rewrite it into a different, entirely plausible
    // Indian number — attaching this thread to whoever owns that one.
    expect(normalizePhone("6590000001")).toBe("+916590000001"); // the trap
    expect(waIdToE164("6590000001")).toBe("+6590000001"); // what we do instead

    expect(waIdToE164("4790000001")).toBe("+4790000001"); // Norway
    expect(waIdToE164("4590000001")).toBe("+4590000001"); // Denmark
    expect(waIdToE164("6420000001")).toBe("+6420000001"); // New Zealand
    expect(waIdToE164("3540000001")).toBe("+3540000001"); // Iceland
  });

  it("keeps a foreign contact off the Indian number it would otherwise collide with", () => {
    // The whole point, stated as the collision it prevents. Under the old
    // reading these two DIFFERENT people resolve to one identical value, and
    // since phoneE164 is the conversation's primary identity, the second one's
    // entire history lands in the first one's thread.
    const singapore = "6590000001";
    const indian = "916590000001";
    expect(normalizePhone(singapore)).toBe(normalizePhone(indian)); // the collision
    expect(waIdToE164(singapore)).not.toBe(waIdToE164(indian)); // no longer
  });

  it("treats a leading international access code as the plus it stands for", () => {
    expect(waIdToE164("00919000000001")).toBe("+919000000001");
    expect(waIdToE164("+919000000001")).toBe("+919000000001");
  });

  it("declines an implausible length instead of guessing at it", () => {
    expect(waIdToE164("12345")).toBeNull();
    expect(waIdToE164("9".repeat(16))).toBeNull();
    expect(waIdToE164("")).toBeNull();
    expect(waIdToE164(null)).toBeNull();
    expect(waIdToE164("not a number")).toBeNull();
  });
});

describe("typedPhoneToE164", () => {
  // The other half of the distinction: a person typing a local mobile into a CRM
  // field does mean the Indian one, and this is where that reading belongs.
  it("keeps the domestic default for a number a human typed", () => {
    expect(typedPhoneToE164("9000000001")).toBe("+919000000001");
    expect(typedPhoneToE164("+353890000000")).toBe("+353890000000");
  });
});
