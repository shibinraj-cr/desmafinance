import { describe, it, expect } from "vitest";
import { mapSheetRow, parseSheetDate, computeExternalKey, SHEET_SOURCES } from "@/lib/crm-sheet-ingest";

const META = SHEET_SOURCES.meta;
const WEBSITE = SHEET_SOURCES.website;

describe("mapSheetRow — Meta", () => {
  it("maps the Meta campaign columns (numeric phone, ISO date)", () => {
    const m = mapSheetRow(META, "GF | Kerala | May 2026 - 2", {
      Date: "2026-05-27T05:47:32+0000",
      "Campaign Name": "GF-Kerala",
      Name: "Asha K",
      Phone: 919876543210, // arrives as a number from Sheets
      Email: " Asha@Gmail.com ",
      "What is your qualification?": "bsn",
      City: "ktm",
    });
    expect(m).not.toBeNull();
    expect(m!.candidateName).toBe("Asha K");
    expect(m!.email).toBe("Asha@Gmail.com");
    expect(m!.emailKey).toBe("asha@gmail.com");
    expect(m!.phoneE164).toBe("+919876543210");
    expect(m!.extra.campaign).toBe("GF | Kerala | May 2026 - 2");
    expect(m!.extra["What is your qualification?"]).toBe("bsn");
    expect(m!.extra.Email).toBeUndefined(); // core fields excluded from extra
    expect(m!.createdAt?.toISOString()).toBe("2026-05-27T05:47:32.000Z");
  });

  it("returns null when there is no candidate name", () => {
    expect(mapSheetRow(META, "X", { Email: "a@b.com" })).toBeNull();
  });
});

describe("mapSheetRow — Website (Contact Form 7 tags)", () => {
  it("maps your-name / your-email / phonetext-354 and a human date", () => {
    const m = mapSheetRow(WEBSITE, "Sheet1", {
      date: "October 14, 2025",
      "your-name": "Vishnu R",
      "your-email": "VISHNU@gmail.com",
      "phonetext-354": "9876543210",
      "your-message": "Interested in Australia",
      "select-857": "7702997",
      "Assigned to": "Shency",
    });
    expect(m).not.toBeNull();
    expect(m!.candidateName).toBe("Vishnu R");
    expect(m!.emailKey).toBe("vishnu@gmail.com");
    expect(m!.phoneE164).toBe("+919876543210");
    expect(m!.extra["your-message"]).toBe("Interested in Australia");
    expect(m!.extra["select-857"]).toBe("7702997");
    expect(m!.extra["Assigned to"]).toBe("Shency"); // sheet assignee kept as context
    expect(m!.extra["your-email"]).toBeUndefined(); // core field excluded
    expect(m!.createdAt?.getFullYear()).toBe(2025);
  });
});

describe("computeExternalKey", () => {
  it("is deterministic for the same row identity (idempotent re-sends)", () => {
    const args = { source: "meta", campaign: "C", dateISO: "2026-05-27T05:47:32.000Z", emailKey: "a@b.com", phoneE164: "+9112345", name: "Asha" };
    expect(computeExternalKey(args)).toBe(computeExternalKey(args));
  });
  it("differs by source so the same person from two sources yields two leads", () => {
    const base = { campaign: "C", dateISO: "d", emailKey: "a@b.com", phoneE164: "+91", name: "Asha" };
    expect(computeExternalKey({ ...base, source: "meta" })).not.toBe(
      computeExternalKey({ ...base, source: "website" }),
    );
  });
  it("is namespaced by source key", () => {
    expect(computeExternalKey({ source: "website", campaign: "C", dateISO: null, emailKey: "a@b.com", phoneE164: null, name: "X" })).toMatch(/^website_/);
  });
});

describe("parseSheetDate", () => {
  it("parses Meta ISO with a +0000 offset", () => {
    expect(parseSheetDate("2026-05-27T05:47:32+0000")?.toISOString()).toBe("2026-05-27T05:47:32.000Z");
  });
  it("parses a human date like 'October 14, 2025'", () => {
    expect(parseSheetDate("October 14, 2025")?.getFullYear()).toBe(2025);
  });
  it("returns null for blank / invalid input", () => {
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetDate("not a date")).toBeNull();
  });
});
