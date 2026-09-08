import { describe, it, expect } from "vitest";
import { isValidPixelId } from "@/lib/hiring/pixel";

describe("Meta pixel id validation", () => {
  it("accepts a real pixel id", () => {
    expect(isValidPixelId("1785507649067229")).toBe(true);
  });

  it("tolerates padding around it", () => {
    expect(isValidPixelId("  1785507649067229 ")).toBe(true);
  });

  /**
   * The id is interpolated into a <script> body, so anything that is not digits
   * must be refused rather than escaped — marketing is nearly always sent the
   * whole snippet, and pasting it in is the expected mistake, not an exotic one.
   */
  it("refuses the whole script block people are actually sent", () => {
    expect(isValidPixelId("fbq('init', '1785507649067229');")).toBe(false);
    expect(isValidPixelId("<script>alert(1)</script>")).toBe(false);
  });

  it("refuses anything that could break out of the script string", () => {
    for (const bad of ["1785507649067229'", "123');alert(1);//", "123\n456", "12'+'34"]) {
      expect(isValidPixelId(bad), `${bad} must be rejected`).toBe(false);
    }
  });

  it("refuses empty and obviously-wrong lengths", () => {
    expect(isValidPixelId("")).toBe(false);
    expect(isValidPixelId("123")).toBe(false);
    expect(isValidPixelId("1".repeat(21))).toBe(false);
  });
});
