import { describe, it, expect } from "vitest";
import { isValidSenderAddress } from "@/lib/hiring/email";

describe("hiring sender address", () => {
  it("accepts the address candidates should see", () => {
    expect(isValidSenderAddress("hr@desma.in")).toBe(true);
    expect(isValidSenderAddress("  hr@desma.in  ")).toBe(true);
  });

  it("refuses things that are not an address", () => {
    for (const bad of ["", "hr", "hr@", "@desma.in", "hr@desma", "hr desma.in"]) {
      expect(isValidSenderAddress(bad), `${bad} must be rejected`).toBe(false);
    }
  });

  /**
   * The value lands in a From header. A newline there is header injection —
   * it would let whoever sets it append Bcc or a second To.
   */
  it("refuses anything carrying a newline", () => {
    expect(isValidSenderAddress("hr@desma.in\nBcc: someone@example.com")).toBe(false);
    expect(isValidSenderAddress("hr@desma.in\r\nBcc: x@y.z")).toBe(false);
  });
});
