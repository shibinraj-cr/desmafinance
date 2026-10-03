import { describe, it, expect } from "vitest";
import {
  headerMediaProblem,
  isServableBroadcastMediaPath,
  safeFileName,
  MAX_HEADER_MEDIA_BYTES,
} from "@/lib/wa/broadcast-media";

describe("headerMediaProblem", () => {
  it("accepts the formats Meta takes for each header kind", () => {
    expect(headerMediaProblem("image", "image/jpeg", 1000)).toBeNull();
    expect(headerMediaProblem("image", "image/png", 1000)).toBeNull();
    expect(headerMediaProblem("video", "video/mp4", 1000)).toBeNull();
    expect(headerMediaProblem("document", "application/pdf", 1000)).toBeNull();
  });

  it("rejects a format Meta would refuse at send time", () => {
    expect(headerMediaProblem("image", "image/webp", 1000)).toMatch(/JPEG or PNG/);
    expect(headerMediaProblem("image", "application/pdf", 1000)).not.toBeNull();
    expect(headerMediaProblem("document", "image/png", 1000)).not.toBeNull();
  });

  it("rejects empty and oversized files", () => {
    expect(headerMediaProblem("image", "image/png", 0)).toMatch(/empty/);
    expect(headerMediaProblem("image", "image/png", MAX_HEADER_MEDIA_BYTES)).toBeNull();
    expect(headerMediaProblem("image", "image/png", MAX_HEADER_MEDIA_BYTES + 1)).toMatch(/4 MB/);
  });
});

describe("isServableBroadcastMediaPath", () => {
  it("serves only the broadcast-media prefix", () => {
    expect(isServableBroadcastMediaPath("wa-broadcast-media/image/promo-AbC123.png")).toBe(true);
    expect(isServableBroadcastMediaPath("hiring/resumes/cv.pdf")).toBe(false);
    expect(isServableBroadcastMediaPath("ops/proof.png")).toBe(false);
  });

  it("refuses dot segments and empty segments", () => {
    expect(isServableBroadcastMediaPath("wa-broadcast-media/../hiring/cv.pdf")).toBe(false);
    expect(isServableBroadcastMediaPath("wa-broadcast-media/./x.png")).toBe(false);
    expect(isServableBroadcastMediaPath("wa-broadcast-media//x.png")).toBe(false);
  });
});

describe("safeFileName", () => {
  it("reduces a name to URL-safe characters", () => {
    expect(safeFileName("Onam Offer (Final) 2026.PNG")).toBe("onam-offer-final-2026.png");
    expect(safeFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFileName("???")).toBe("header");
  });
});
