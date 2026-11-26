import { describe, expect, it } from "vitest";
import {
  MEDIA_CATEGORY_CODES,
  categoryFromFormat,
  categoryLabel,
  deriveMediaFormat,
  mediaChecklist,
  platformFromFormat,
  platformMeta,
} from "@/lib/media-plan-shared";

describe("deriveMediaFormat", () => {
  it("keeps the legacy format in step with platform + category", () => {
    expect(deriveMediaFormat("youtube", "animated_ml")).toBe("short");
    expect(deriveMediaFormat("youtube", null)).toBe("short");
    expect(deriveMediaFormat("youtube", "longform")).toBe("video");
    expect(deriveMediaFormat("instagram", "anchoring")).toBe("reel");
    expect(deriveMediaFormat("linkedin", "longform_cut")).toBe("reel");
    expect(deriveMediaFormat("facebook", "poster")).toBe("poster");
  });
});

describe("legacy format mapping", () => {
  it("maps a format-only item onto platform and category", () => {
    expect(platformFromFormat("short")).toBe("youtube");
    expect(platformFromFormat("video")).toBe("youtube");
    expect(platformFromFormat("reel")).toBe("instagram");
    expect(categoryFromFormat("video")).toBe("longform");
    expect(categoryFromFormat("poster")).toBe("poster");
    expect(categoryFromFormat("short")).toBeNull();
  });
});

describe("labels and checklists", () => {
  it("names every category and falls back for unknowns", () => {
    for (const c of MEDIA_CATEGORY_CODES) expect(categoryLabel(c)).not.toBe(c);
    expect(categoryLabel(null)).toBe("Uncategorised");
    expect(categoryLabel("animated_ml")).toBe("Animated Reels/Shorts Malayalam");
    expect(platformMeta("linkedin").pill).toBe("IN");
    expect(platformMeta("tiktok").label).toBe("tiktok");
  });

  it("seeds a category checklist, or the format's when uncategorised", () => {
    expect(mediaChecklist("poster", "poster")).toEqual(["Design", "Approval", "Publish"]);
    expect(mediaChecklist("animated_en", "short")).toContain("Voice-over");
    expect(mediaChecklist(null, "video")).toContain("Thumbnail");
  });
});
