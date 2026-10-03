import { describe, expect, it } from "vitest";
import {
  cleanName,
  contentDisposition,
  descendantFolderIds,
  extensionOf,
  folderChain,
  isFinanceDocUploadPath,
  newShareToken,
  renamedDocumentName,
  safeBlobFileName,
  sharePeriod,
  shareState,
} from "@/lib/finance-docs";

describe("names", () => {
  it("tidies whitespace, slashes and control characters", () => {
    expect(cleanName("  GST   returns\t2025 ")).toBe("GST returns 2025");
    expect(cleanName("Bank/HDFC")).toBe("Bank-HDFC");
    expect(cleanName("a\u0000b")).toBe("ab");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("..")).toBeNull();
  });

  it("reads extensions conservatively", () => {
    expect(extensionOf("Invoice.PDF")).toBe(".PDF");
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
    expect(extensionOf(".env")).toBe("");
    expect(extensionOf("FY 2025.26 report")).toBe("");
    expect(extensionOf("trailing.")).toBe("");
  });

  it("keeps the old extension when a rename drops it", () => {
    expect(renamedDocumentName("GST return", "gstr3b.pdf")).toBe("GST return.pdf");
    expect(renamedDocumentName("GST return.xlsx", "gstr3b.pdf")).toBe("GST return.xlsx");
    expect(renamedDocumentName("notes", "notes")).toBe("notes");
    expect(renamedDocumentName("  ", "a.pdf")).toBeNull();
  });
});

describe("blob paths", () => {
  it("makes safe keys", () => {
    expect(safeBlobFileName("Bank Statement (Apr).PDF")).toBe("bank-statement-apr-.pdf");
    expect(safeBlobFileName("ബാങ്ക്.pdf")).toBe("pdf");
    expect(safeBlobFileName("....")).toBe("document");
  });

  it("only issues tokens under our prefix, one level deep", () => {
    expect(isFinanceDocUploadPath("finance-docs/statement.pdf")).toBe(true);
    expect(isFinanceDocUploadPath("finance-docs/a/b.pdf")).toBe(false);
    expect(isFinanceDocUploadPath("finance-docs/../hiring/x.pdf")).toBe(false);
    expect(isFinanceDocUploadPath("hiring/resume.pdf")).toBe(false);
    expect(isFinanceDocUploadPath("finance-docs/")).toBe(false);
  });

  it("encodes non-ASCII download names", () => {
    const v = contentDisposition("attachment", 'Q1 "final" ₹.pdf');
    expect(v).toContain('filename="Q1 _final_ _.pdf"');
    expect(v).toContain("filename*=UTF-8''Q1%20%22final%22%20%E2%82%B9.pdf");
  });
});

describe("folder tree", () => {
  const folders = [
    { id: "fy", name: "FY 2025-26", parentId: null },
    { id: "bank", name: "Bank", parentId: "fy" },
    { id: "hdfc", name: "HDFC", parentId: "bank" },
    { id: "gst", name: "GST", parentId: "fy" },
    { id: "other", name: "Other", parentId: null },
  ];

  it("collects a folder and everything beneath it", () => {
    expect([...descendantFolderIds(folders, "fy")].sort()).toEqual(["bank", "fy", "gst", "hdfc"]);
    expect([...descendantFolderIds(folders, "hdfc")]).toEqual(["hdfc"]);
  });

  it("survives a cycle", () => {
    const cyclic = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    expect([...descendantFolderIds(cyclic, "a")].sort()).toEqual(["a", "b"]);
    expect(folderChain(cyclic, "a").map((f) => f.id)).toEqual(["b", "a"]);
  });

  it("builds breadcrumbs, optionally hiding what a shared folder sits in", () => {
    expect(folderChain(folders, "hdfc").map((f) => f.name)).toEqual(["FY 2025-26", "Bank", "HDFC"]);
    expect(folderChain(folders, "hdfc", "fy").map((f) => f.name)).toEqual(["Bank", "HDFC"]);
    expect(folderChain(folders, null)).toEqual([]);
  });
});

describe("share period", () => {
  // 3 Oct 2026, 10:00 IST
  const now = new Date("2026-10-03T04:30:00Z");

  it("opens now for a period starting today and closes at the end of the last IST day", () => {
    const p = sharePeriod("2026-10-03", "2026-10-09", now);
    if ("error" in p) throw new Error(p.error);
    expect(p.validFrom).toEqual(now);
    expect(p.expiresAt.toISOString()).toBe("2026-10-09T18:29:59.999Z");
  });

  it("opens at IST midnight for a future start", () => {
    const p = sharePeriod("2026-10-10", "2026-10-10", now);
    if ("error" in p) throw new Error(p.error);
    expect(p.validFrom.toISOString()).toBe("2026-10-09T18:30:00.000Z");
  });

  it("treats today in IST, not UTC", () => {
    // 2 Oct 20:00 UTC is already 3 Oct in IST.
    const late = new Date("2026-10-02T20:00:00Z");
    expect("error" in sharePeriod("2026-10-03", "2026-10-03", late)).toBe(false);
    expect("error" in sharePeriod("2026-10-02", "2026-10-03", late)).toBe(true);
  });

  it("rejects bad periods", () => {
    expect(sharePeriod("2026-10-05", "2026-10-04", now)).toHaveProperty("error");
    expect(sharePeriod("2026-02-31", "2026-03-01", now)).toHaveProperty("error");
    expect(sharePeriod("2026-10-03", "2027-12-01", now)).toHaveProperty("error");
    expect(sharePeriod("nope", "2026-10-04", now)).toHaveProperty("error");
  });

  it("reports state", () => {
    const base = { validFrom: new Date("2026-10-03T00:00:00Z"), expiresAt: new Date("2026-10-05T00:00:00Z"), revokedAt: null };
    expect(shareState(base, new Date("2026-10-02T00:00:00Z"))).toBe("scheduled");
    expect(shareState(base, new Date("2026-10-04T00:00:00Z"))).toBe("active");
    expect(shareState(base, new Date("2026-10-05T00:00:00Z"))).toBe("expired");
    expect(shareState({ ...base, revokedAt: new Date() }, new Date("2026-10-04T00:00:00Z"))).toBe("revoked");
  });

  it("mints unguessable, URL-safe tokens", () => {
    const t = newShareToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newShareToken()).not.toBe(t);
  });
});
