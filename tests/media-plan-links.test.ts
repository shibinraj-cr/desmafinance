import { describe, expect, it } from "vitest";
import { isSafeHttpUrl, linkPlatform, youtubeVideoId } from "@/lib/media-plan-shared";
import { mediaThumbnailUrl } from "@/lib/media-plan";

describe("youtubeVideoId", () => {
  it("reads every common YouTube URL shape", () => {
    expect(youtubeVideoId("https://youtube.com/shorts/d3RWho7op_g")).toBe("d3RWho7op_g");
    expect(youtubeVideoId("https://www.youtube.com/watch?v=EDjjamH7KvQ&t=3")).toBe("EDjjamH7KvQ");
    expect(youtubeVideoId("https://youtu.be/EDjjamH7KvQ?si=x")).toBe("EDjjamH7KvQ");
    expect(youtubeVideoId("https://m.youtube.com/embed/EDjjamH7KvQ")).toBe("EDjjamH7KvQ");
    expect(youtubeVideoId("https://studio.youtube.com/video/VzFo-_-keAs/edit")).toBe("VzFo-_-keAs");
  });

  it("returns null for non-YouTube or malformed links", () => {
    expect(youtubeVideoId(null)).toBeNull();
    expect(youtubeVideoId("not a url")).toBeNull();
    expect(youtubeVideoId("https://www.instagram.com/reel/abc/")).toBeNull();
    expect(youtubeVideoId("https://youtube.com/shorts/short")).toBeNull();
    expect(youtubeVideoId("https://evil.com/shorts/d3RWho7op_g")).toBeNull();
  });
});

describe("isSafeHttpUrl", () => {
  it("allows only http(s)", () => {
    expect(isSafeHttpUrl("https://youtube.com/shorts/d3RWho7op_g")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,hi")).toBe(false);
    expect(isSafeHttpUrl("youtube.com/shorts/x")).toBe(false);
  });
});

describe("linkPlatform", () => {
  it("names the main platforms", () => {
    expect(linkPlatform("https://youtu.be/EDjjamH7KvQ")).toBe("YouTube");
    expect(linkPlatform("https://www.instagram.com/reel/abc/")).toBe("Instagram");
    expect(linkPlatform("https://www.linkedin.com/feed/update/x")).toBe("LinkedIn");
    expect(linkPlatform("https://example.org/a")).toBe("example.org");
  });
});

describe("mediaThumbnailUrl", () => {
  const base = { id: "item1", link: null, thumbnailPath: null, thumbnailUpdatedAt: null };

  it("prefers the uploaded thumbnail, cache-busted by its update time", () => {
    expect(
      mediaThumbnailUrl({
        ...base,
        link: "https://youtube.com/shorts/d3RWho7op_g",
        thumbnailPath: "media-plan/thumbnails/item1-1.jpg",
        thumbnailUpdatedAt: new Date(1000),
      }),
    ).toBe("/api/marketing/media-plan/item1/thumbnail?v=1000");
  });

  it("falls back to YouTube's thumbnail, then to nothing", () => {
    expect(mediaThumbnailUrl({ ...base, link: "https://youtube.com/shorts/d3RWho7op_g" })).toBe(
      "https://i.ytimg.com/vi/d3RWho7op_g/mqdefault.jpg",
    );
    expect(mediaThumbnailUrl({ ...base, link: "https://www.instagram.com/reel/abc/" })).toBeNull();
    expect(mediaThumbnailUrl(base)).toBeNull();
  });
});
