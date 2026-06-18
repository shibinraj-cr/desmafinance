import { describe, it, expect } from "vitest";
import { mapMetaRow, parseMetaDate, computeMetaExternalKey } from "@/lib/crm-meta-ingest";

describe("mapMetaRow", () => {
  it("maps the Other-states / Kerala campaign columns", () => {
    const m = mapMetaRow("GF | Kerala | May 2026 - 2", {
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
    expect(m!.email).toBe("Asha@Gmail.com"); // raw (trimmed) kept for display
    expect(m!.emailKey).toBe("asha@gmail.com"); // lowercased match key
    expect(m!.phoneE164).toBe("+919876543210"); // numeric phone normalised
    expect(m!.extra.campaign).toBe("GF | Kerala | May 2026 - 2");
    expect(m!.extra["What is your qualification?"]).toBe("bsn");
    expect(m!.extra["Campaign Name"]).toBe("GF-Kerala");
    expect(m!.extra.Email).toBeUndefined(); // core fields excluded from extra
    expect(m!.createdAt?.toISOString()).toBe("2026-05-27T05:47:32.000Z");
  });

  it("maps the GCC campaign's 'Full Name' / 'Phone Number' headers", () => {
    const m = mapMetaRow("GF | EXP GCC NEW MAY 2026", {
      "Full Name": "Ravi",
      "Phone Number": "09876543211",
      Email: "",
      plaform: "fb",
    });
    expect(m!.candidateName).toBe("Ravi");
    expect(m!.email).toBeNull();
    expect(m!.emailKey).toBeNull();
    expect(m!.phoneE164).toBe("+919876543211");
    expect(m!.extra.plaform).toBe("fb");
  });

  it("returns null when there is no candidate name", () => {
    expect(mapMetaRow("X", { Email: "a@b.com" })).toBeNull();
  });
});

describe("computeMetaExternalKey", () => {
  it("is deterministic for the same row identity (idempotent re-sends)", () => {
    const args = { campaign: "C", dateISO: "2026-05-27T05:47:32.000Z", emailKey: "a@b.com", phoneE164: "+9112345", name: "Asha" };
    expect(computeMetaExternalKey(args)).toBe(computeMetaExternalKey(args));
  });
  it("differs by campaign so the same person in two tabs yields two leads", () => {
    const base = { dateISO: "d", emailKey: "a@b.com", phoneE164: "+91", name: "Asha" };
    expect(computeMetaExternalKey({ ...base, campaign: "A" })).not.toBe(
      computeMetaExternalKey({ ...base, campaign: "B" }),
    );
  });
});

describe("parseMetaDate", () => {
  it("parses Meta ISO with a +0000 offset", () => {
    expect(parseMetaDate("2026-05-27T05:47:32+0000")?.toISOString()).toBe("2026-05-27T05:47:32.000Z");
  });
  it("returns null for blank / invalid input", () => {
    expect(parseMetaDate("")).toBeNull();
    expect(parseMetaDate("not a date")).toBeNull();
  });
});
