import { describe, it, expect } from "vitest";
import { isAnalyzableMime } from "@/lib/ops-doc-ai";

describe("isAnalyzableMime", () => {
  it("accepts images and PDF (case-insensitive)", () => {
    for (const m of ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "application/pdf", "IMAGE/PNG"]) {
      expect(isAnalyzableMime(m)).toBe(true);
    }
  });

  it("rejects non-image/PDF types and empties", () => {
    for (const m of ["application/vnd.ms-excel", "text/plain", "application/msword", "", null, undefined]) {
      expect(isAnalyzableMime(m)).toBe(false);
    }
  });
});
