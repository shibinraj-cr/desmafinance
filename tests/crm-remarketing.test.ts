import { describe, it, expect } from "vitest";
import {
  parseOffsets,
  parseKeywords,
  parseUrls,
  daysBetween,
  dueTouchIndex,
  isCampaignExpired,
  matchesReengageKeyword,
} from "@/lib/crm-remarketing";

const DAY = 86_400_000;
const start = new Date("2026-01-01T00:00:00.000Z");
const plusDays = (n: number) => new Date(start.getTime() + n * DAY);

describe("parseOffsets", () => {
  it("defaults to 5/19/33/45 when empty or unusable", () => {
    expect(parseOffsets(null)).toEqual([5, 19, 33, 45]);
    expect(parseOffsets("")).toEqual([5, 19, 33, 45]);
    expect(parseOffsets("abc, x")).toEqual([5, 19, 33, 45]);
  });
  it("parses, sorts ascending and de-duplicates", () => {
    expect(parseOffsets("33, 5, 19")).toEqual([5, 19, 33]);
    expect(parseOffsets("5,5,19")).toEqual([5, 19]);
  });
  it("drops negatives and caps at four", () => {
    expect(parseOffsets("-1, 5, 10")).toEqual([5, 10]);
    expect(parseOffsets("1,2,3,4,5")).toEqual([1, 2, 3, 4]);
  });
  it("accepts day 0 (send immediately)", () => {
    expect(parseOffsets("0, 7, 14")).toEqual([0, 7, 14]);
  });
});

describe("parseKeywords", () => {
  it("returns [] when unset (any reply advances)", () => {
    expect(parseKeywords(null)).toEqual([]);
    expect(parseKeywords("")).toEqual([]);
  });
  it("lowercases, trims, and drops blanks", () => {
    expect(parseKeywords("Interested, Yes")).toEqual(["interested", "yes"]);
    expect(parseKeywords("a,, b , ")).toEqual(["a", "b"]);
  });
});

describe("parseUrls", () => {
  it("returns [] when unset", () => {
    expect(parseUrls(null)).toEqual([]);
    expect(parseUrls("")).toEqual([]);
  });
  it("splits newline-separated URLs and trims each", () => {
    expect(parseUrls("https://a/webhook/1 \n https://b/webhook/2")).toEqual([
      "https://a/webhook/1",
      "https://b/webhook/2",
    ]);
  });
  it("keeps interior blanks (position = touch) but drops trailing ones", () => {
    expect(parseUrls("https://a/webhook/1\n\nhttps://c/webhook/3\n\n")).toEqual([
      "https://a/webhook/1",
      "",
      "https://c/webhook/3",
    ]);
  });
});

describe("daysBetween", () => {
  it("counts whole calendar days, floor, never negative", () => {
    expect(daysBetween(start, start)).toBe(0);
    expect(daysBetween(start, plusDays(5))).toBe(5);
    expect(daysBetween(start, new Date(start.getTime() + 12 * 3_600_000))).toBe(0); // 12h
    expect(daysBetween(plusDays(5), start)).toBe(0); // to before from
  });
});

describe("dueTouchIndex", () => {
  const offsets = [5, 19, 33];

  it("returns null before the first offset", () => {
    expect(dueTouchIndex({ startedAt: start, now: plusDays(4), offsets, sent: [false, false, false] })).toBeNull();
  });
  it("returns touch 1 the day its offset arrives", () => {
    expect(dueTouchIndex({ startedAt: start, now: plusDays(5), offsets, sent: [false, false, false] })).toBe(1);
  });
  it("does not jump ahead: touch 1 sent, touch 2 not yet due", () => {
    expect(dueTouchIndex({ startedAt: start, now: plusDays(5), offsets, sent: [true, false, false] })).toBeNull();
  });
  it("returns touch 2 once its offset arrives and touch 1 is done", () => {
    expect(dueTouchIndex({ startedAt: start, now: plusDays(19), offsets, sent: [true, false, false] })).toBe(2);
  });
  it("returns touch 3 at its offset", () => {
    expect(dueTouchIndex({ startedAt: start, now: plusDays(33), offsets, sent: [true, true, false] })).toBe(3);
  });
  it("returns null when all sent", () => {
    expect(dueTouchIndex({ startedAt: start, now: plusDays(40), offsets, sent: [true, true, true] })).toBeNull();
  });
  it("catches up earliest-first when the cron fell behind", () => {
    // Way past all offsets, nothing sent → sends touch 1 first (one per run).
    expect(dueTouchIndex({ startedAt: start, now: plusDays(40), offsets, sent: [false, false, false] })).toBe(1);
  });
  it("handles a 4th touch at day 45", () => {
    const four = [5, 19, 33, 45];
    expect(dueTouchIndex({ startedAt: start, now: plusDays(44), offsets: four, sent: [true, true, true, false] })).toBeNull();
    expect(dueTouchIndex({ startedAt: start, now: plusDays(45), offsets: four, sent: [true, true, true, false] })).toBe(4);
    expect(dueTouchIndex({ startedAt: start, now: plusDays(45), offsets: four, sent: [true, true, true, true] })).toBeNull();
  });
});

describe("isCampaignExpired", () => {
  const offsets = [5, 19, 33]; // grace is 7 days → expiry at day 40

  it("is false until the grace window past the last touch elapses", () => {
    expect(isCampaignExpired({ startedAt: start, now: plusDays(39), offsets, sent: [true, true, true] })).toBe(false);
    expect(isCampaignExpired({ startedAt: start, now: plusDays(40), offsets, sent: [true, true, true] })).toBe(true);
  });
  it("is never expired while a touch is still unsent", () => {
    expect(isCampaignExpired({ startedAt: start, now: plusDays(100), offsets, sent: [true, true, false] })).toBe(false);
  });
  it("with 4 touches, expires 7 days after the day-45 touch", () => {
    const four = [5, 19, 33, 45];
    expect(isCampaignExpired({ startedAt: start, now: plusDays(51), offsets: four, sent: [true, true, true, true] })).toBe(false);
    expect(isCampaignExpired({ startedAt: start, now: plusDays(52), offsets: four, sent: [true, true, true, true] })).toBe(true);
  });
});

describe("matchesReengageKeyword", () => {
  it("advances on any reply when no keywords are configured", () => {
    expect(matchesReengageKeyword("anything", [])).toBe(true);
    expect(matchesReengageKeyword("", [])).toBe(true);
  });
  it("matches a keyword case-insensitively as a substring", () => {
    expect(matchesReengageKeyword("I am Interested now", ["interested"])).toBe(true);
    expect(matchesReengageKeyword("YES please", ["interested", "yes"])).toBe(true);
  });
  it("does not advance on a non-matching or empty reply when keywords are set", () => {
    expect(matchesReengageKeyword("not now", ["interested"])).toBe(false);
    expect(matchesReengageKeyword("", ["interested"])).toBe(false);
    expect(matchesReengageKeyword(null, ["interested"])).toBe(false);
  });
});
