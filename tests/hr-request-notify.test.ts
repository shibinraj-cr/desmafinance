import { describe, it, expect } from "vitest";
import { kindLabel } from "@/lib/hr-request-notify";

// These strings are what the employee and HR actually read in the notification
// title and body, so they are worth pinning.
describe("kindLabel", () => {
  it("names a full-day leave request", () => {
    expect(kindLabel("leave", null)).toBe("Leave");
  });

  it("names which half a half-day leave covers", () => {
    expect(kindLabel("leave", "AM")).toBe("Half-day leave (first half)");
    expect(kindLabel("leave", "PM")).toBe("Half-day leave (second half)");
  });

  it("names an explanation, which changes nothing on approval", () => {
    expect(kindLabel("note", null)).toBe("Explanation");
  });

  it("treats anything else as a punch correction", () => {
    expect(kindLabel("punch", null)).toBe("Punch correction");
  });

  it("ignores a half on a non-leave request", () => {
    // Only a leave request carries a half; a stray value must not leak into
    // the label.
    expect(kindLabel("punch", "AM")).toBe("Punch correction");
  });
});
