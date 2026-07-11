import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  normalizeHeader,
  coercePhoneCell,
  parseMetaDate,
  parseSinceDate,
  parseMetaWorkbook,
  collectLookupKeys,
  reconcileRows,
  metaRowKeys,
  isReconcilable,
  type MetaLeadRow,
} from "@/lib/crm-meta-reconcile";

// crm-meta-reconcile only imports xlsx + the pure crm helpers — no prisma — so
// these run without any DB mocking.

function wbBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function row(over: Partial<MetaLeadRow>): MetaLeadRow {
  return {
    sheetName: "S",
    rowNumber: 2,
    campaign: "S",
    candidateName: "X",
    email: null,
    phone: null,
    altPhone: null,
    phoneE164: null,
    altPhoneE164: null,
    emailKey: null,
    city: null,
    createdAt: "2026-06-10T00:00:00.000Z",
    extra: null,
    ...over,
  };
}

describe("normalizeHeader", () => {
  it("trims, lowercases, collapses whitespace/newlines", () => {
    expect(normalizeHeader(" Email")).toBe("email");
    expect(normalizeHeader("Phone Number")).toBe("phone number");
    expect(normalizeHeader("Are you comfortable working \non-site")).toBe("are you comfortable working on-site");
  });
});

describe("coercePhoneCell — the scientific-notation trap", () => {
  it("stringifies a numeric phone WITHOUT losing digits or adding notation", () => {
    // Excel stores these as numbers; raw:true hands us the integer.
    expect(coercePhoneCell(919746399999)).toBe("919746399999");
    expect(coercePhoneCell(7306904001)).toBe("7306904001");
    expect(coercePhoneCell(96894597587)).toBe("96894597587");
  });
  it("passes text phones through", () => {
    expect(coercePhoneCell("+91 78142 95082")).toBe("+91 78142 95082");
    expect(coercePhoneCell("")).toBe("");
    expect(coercePhoneCell(null)).toBe("");
  });
});

describe("parseMetaDate", () => {
  it("parses Meta ISO strings with +0000 and +05:30 offsets", () => {
    expect(parseMetaDate("2026-05-27T06:10:32+0000")?.toISOString()).toBe("2026-05-27T06:10:32.000Z");
    expect(parseMetaDate("2025-04-08T06:15:36+05:30")?.toISOString()).toBe("2025-04-08T00:45:36.000Z");
  });
  it("parses a Date object and dd-mm-yyyy fallback", () => {
    const d = new Date("2026-01-02T03:04:05Z");
    expect(parseMetaDate(d)).toBe(d);
    expect(parseMetaDate("24-06-2026, 2:23 pm")?.getFullYear()).toBe(2026);
    expect(parseMetaDate("24-06-2026, 2:23 pm")?.getMonth()).toBe(5); // June
  });
  it("returns null for blanks and bare numbers", () => {
    expect(parseMetaDate("")).toBeNull();
    expect(parseMetaDate(null)).toBeNull();
    expect(parseMetaDate(45000)).toBeNull();
  });
});

describe("parseSinceDate", () => {
  it("accepts YYYY-MM-DD and rejects junk", () => {
    expect(parseSinceDate("2026-06-01")).toBeInstanceOf(Date);
    expect(parseSinceDate("01/06/2026")).toBeNull();
    expect(parseSinceDate("nonsense")).toBeNull();
  });
});

describe("parseMetaWorkbook", () => {
  const buf = wbBuffer({
    "Campaign A": [
      ["Date", "Campaign Name", "Full Name", "Phone Number", "Enter Your Whatsapp Number", "Email", "City"],
      ["2026-06-05T10:00:00+0000", "GF | Kerala | June", "Asha K", 919746399999, 918888888888, "asha@example.com", "Kochi"],
    ],
    "Col1 Date": [
      // date column mislabeled as "Column 1" — must be detected positionally
      ["Column 1", "Campaign Name", "Full Name", "Phone Number"],
      ["2026-06-06T11:00:00+0000", "GF | GCC", "Manu M", 96894597587],
    ],
    "Daily Report": [
      ["Date:25/08/2025", "No of Leads", "Disqualified"],
      ["Open Group | Qatar", 8, 1],
    ],
  });
  const { sheets } = parseMetaWorkbook(buf);

  it("maps varied headers, treats WhatsApp as altPhone, keeps phone precision", () => {
    const a = sheets.find((s) => s.sheetName === "Campaign A")!;
    expect(a.skipped).toBe(false);
    expect(a.mapping.candidateName).toBe("Full Name");
    expect(a.mapping.altPhone).toBe("Enter Your Whatsapp Number");
    const r = a.rows[0];
    expect(r.candidateName).toBe("Asha K");
    expect(r.phone).toBe("919746399999"); // NOT "9.19746E+11"
    expect(r.phoneE164).toBe("+919746399999");
    expect(r.altPhoneE164).toBe("+918888888888");
    expect(r.emailKey).toBe("asha@example.com");
    expect(r.campaign).toBe("GF | Kerala | June"); // per-row campaign column wins
    expect(r.city).toBe("Kochi");
    expect(r.createdAt).toBe("2026-06-05T10:00:00.000Z");
  });

  it("detects a positionally-placed date column (labeled 'Column 1')", () => {
    const c = sheets.find((s) => s.sheetName === "Col1 Date")!;
    expect(c.skipped).toBe(false);
    expect(c.rows[0].createdAt).toBe("2026-06-06T11:00:00.000Z");
    expect(c.rows[0].campaign).toBe("GF | GCC");
  });

  it("skips a non-lead summary sheet", () => {
    const d = sheets.find((s) => s.sheetName === "Daily Report")!;
    expect(d.skipped).toBe(true);
    expect(d.rows).toHaveLength(0);
  });
});

describe("reconcileRows", () => {
  const since = parseSinceDate("2026-06-01")!;
  const empty = { emailKeys: new Set<string>(), phoneKeys: new Set<string>() };

  it("buckets unmatchable / no-date / before-date rows", () => {
    const rows = [
      row({ rowNumber: 1, candidateName: "No contact" }), // unmatchable
      row({ rowNumber: 2, phoneE164: "+911111111111", createdAt: null }), // no date
      row({ rowNumber: 3, phoneE164: "+912222222222", createdAt: "2026-05-01T00:00:00Z" }), // before
    ];
    const b = reconcileRows(rows, since, empty);
    expect(b.unmatchable.map((r) => r.rowNumber)).toEqual([1]);
    expect(b.noDate.map((r) => r.rowNumber)).toEqual([2]);
    expect(b.beforeSince.map((r) => r.rowNumber)).toEqual([3]);
    expect(b.missing).toHaveLength(0);
  });

  it("marks a row already in CRM as matched, not missing", () => {
    const rows = [row({ phoneE164: "+913333333333" })];
    const existing = { emailKeys: new Set<string>(), phoneKeys: new Set(["+913333333333"]) };
    const b = reconcileRows(rows, since, existing);
    expect(b.matchedInCrm).toHaveLength(1);
    expect(b.missing).toHaveLength(0);
  });

  it("de-dupes within the file: first sighting missing, later ones folded", () => {
    const rows = [
      row({ rowNumber: 10, phoneE164: "+914444444444" }),
      row({ rowNumber: 11, phoneE164: "+914444444444" }), // same person, later row
      row({ rowNumber: 12, emailKey: "z@z.com", phoneE164: "+915555555555" }),
    ];
    const b = reconcileRows(rows, since, empty);
    expect(b.missing.map((r) => r.rowNumber).sort()).toEqual([10, 12]);
    expect(b.withinFileDupes.map((r) => r.rowNumber)).toEqual([11]);
  });

  it("matches on email OR alternate phone independently", () => {
    const rows = [row({ emailKey: "e@e.com", phoneE164: "+916666666666" })];
    const byEmail = reconcileRows(rows, since, { emailKeys: new Set(["e@e.com"]), phoneKeys: new Set() });
    expect(byEmail.matchedInCrm).toHaveLength(1);
    const rows2 = [row({ altPhoneE164: "+917777777777" })];
    const byAlt = reconcileRows(rows2, since, { emailKeys: new Set(), phoneKeys: new Set(["+917777777777"]) });
    expect(byAlt.matchedInCrm).toHaveLength(1);
  });
});

describe("collectLookupKeys", () => {
  it("gathers only in-window, reconcilable keys", () => {
    const since = parseSinceDate("2026-06-01")!;
    const rows = [
      row({ emailKey: "a@a.com", phoneE164: "+911111111111" }), // in window
      row({ phoneE164: "+912222222222", createdAt: "2026-05-01T00:00:00Z" }), // before → excluded
      row({ phoneE164: "+913333333333", createdAt: null }), // no date → excluded
      row({ candidateName: "no contact" }), // unmatchable → excluded
    ];
    const { emailKeys, phoneKeys } = collectLookupKeys(rows, since);
    expect(emailKeys).toEqual(["a@a.com"]);
    expect(phoneKeys).toEqual(["+911111111111"]);
  });
});

describe("row helpers", () => {
  it("isReconcilable / metaRowKeys reflect the contact fields", () => {
    expect(isReconcilable(row({}))).toBe(false);
    expect(isReconcilable(row({ phoneE164: "+91999" }))).toBe(true);
    const keys = metaRowKeys(row({ emailKey: "k@k.com", phoneE164: "+91a", altPhoneE164: "+91b" }));
    expect(keys.emailKey).toBe("k@k.com");
    expect(keys.phoneKeys).toEqual(["+91a", "+91b"]);
  });
});
