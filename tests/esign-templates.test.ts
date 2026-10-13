import { describe, expect, it } from "vitest";
import {
  RANGE_CHUNK_BYTES,
  TemplateSettingsSchema,
  isTemplateUploadPath,
  normalizeRotation,
  parseByteRange,
  planFieldSave,
  rangeChunks,
  readPageGeometry,
  templateUploadPath,
} from "@/lib/esign/templates";
import {
  DEFAULT_SIZE_PT,
  MIN_SIZE_PT,
  carryFieldsForward,
  clampBox,
  copyFieldToPages,
  fieldWarnings,
  isAutoKey,
  keyForMergeKey,
  newField,
  normalizeField,
  parsePageList,
  sortFields,
  uniqueKey,
  validateFields,
  type TemplateField,
} from "@/lib/esign/template-fields";
import { MERGE_KEYS, MERGE_KEY_SET } from "@/lib/esign/merge-keys";

const A4 = { w: 595.28, h: 841.89 };

function field(partial: Partial<TemplateField> = {}): TemplateField {
  return {
    key: "text_1",
    label: null,
    type: "text",
    role: "Client",
    page: 1,
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.03,
    required: true,
    options: null,
    mergeKey: null,
    fontSize: 11,
    alignment: "left",
    ...partial,
  };
}

describe("upload paths", () => {
  it("builds a tidy pdf pathname under the prefix", () => {
    expect(templateUploadPath("AHPRA Agreement (v3).PDF")).toBe("esign/templates/ahpra-agreement-v3.pdf");
    expect(templateUploadPath("नर्स.pdf")).toBe("esign/templates/document.pdf");
    expect(isTemplateUploadPath(templateUploadPath("x y.pdf"))).toBe(true);
  });

  it("refuses anything outside the prefix, nested, or not a pdf", () => {
    expect(isTemplateUploadPath("esign/templates/a-b_c.pdf")).toBe(true);
    // The pathname Blob hands back carries a mixed-case random suffix.
    expect(isTemplateUploadPath("esign/templates/ahpra-agreement-Xy7QkL0aBcD.pdf")).toBe(true);
    expect(isTemplateUploadPath("finance-docs/a.pdf")).toBe(false);
    expect(isTemplateUploadPath("esign/templates/sub/a.pdf")).toBe(false);
    expect(isTemplateUploadPath("esign/templates/../a.pdf")).toBe(false);
    expect(isTemplateUploadPath("esign/templates/a.exe")).toBe(false);
  });
});

describe("settings schema", () => {
  it("leaves absent fields absent so a partial update cannot clear them", () => {
    const parsed = TemplateSettingsSchema.parse({ active: false });
    expect(parsed).toEqual({ active: false });
    expect("description" in parsed && parsed.description !== undefined).toBe(false);
  });

  it("clears text on explicit null or blank, trims otherwise", () => {
    const parsed = TemplateSettingsSchema.parse({ description: "  ", emailSubject: null, emailBody: " Hi ", whatsappTemplateName: "" });
    expect(parsed.description).toBeNull();
    expect(parsed.emailSubject).toBeNull();
    expect(parsed.emailBody).toBe("Hi");
    expect(parsed.whatsappTemplateName).toBeNull();
  });

  it("validates categories, day ranges and Meta template names", () => {
    expect(() => TemplateSettingsSchema.parse({ category: "Mortgage" })).toThrow();
    expect(() => TemplateSettingsSchema.parse({ defaultExpiryDays: 0 })).toThrow();
    expect(TemplateSettingsSchema.parse({ defaultReminderDays: 0 }).defaultReminderDays).toBe(0);
    expect(() => TemplateSettingsSchema.parse({ whatsappTemplateName: "Agreement Link" })).toThrow();
    expect(TemplateSettingsSchema.parse({ whatsappTemplateName: "agreement_link_v2" }).whatsappTemplateName).toBe(
      "agreement_link_v2",
    );
  });
});

describe("byte ranges", () => {
  const size = 10 * 1024 * 1024;
  it("is null without a header and invalid when unsatisfiable", () => {
    expect(parseByteRange(null, size)).toBeNull();
    expect(parseByteRange("bytes=-", size)).toBe("invalid");
    expect(parseByteRange("bytes=5-2", size)).toBe("invalid");
    expect(parseByteRange(`bytes=${size}-`, size)).toBe("invalid");
    expect(parseByteRange("bytes=0-1,5-6", size)).toBe("invalid");
    expect(parseByteRange("items=0-1", size)).toBe("invalid");
  });

  it("reads explicit, open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=0-99", size)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=-100", size)).toEqual({ start: size - 100, end: size - 1 });
    expect(parseByteRange("bytes=0-99999999999", 50)).toEqual({ start: 0, end: 49 });
  });

  it("shortens long spans to one chunk", () => {
    expect(parseByteRange("bytes=0-", size)).toEqual({ start: 0, end: RANGE_CHUNK_BYTES - 1 });
  });

  it("chunks cover a file exactly once", () => {
    const parts = rangeChunks(5_000_001, 2_000_000);
    expect(parts).toEqual([
      { start: 0, end: 1_999_999 },
      { start: 2_000_000, end: 3_999_999 },
      { start: 4_000_000, end: 5_000_000 },
    ]);
  });
});

describe("page geometry", () => {
  it("normalises rotations", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
  });

  it("falls back to A4 for malformed rows", () => {
    const g = readPageGeometry([{ w: 612, h: 792, rotate: 0, box: [0, 0, 612, 792] }, null], 2);
    expect(g[0]).toEqual({ w: 612, h: 792, rotate: 0, box: [0, 0, 612, 792] });
    expect(g[1].w).toBeCloseTo(595.28);
  });
});

describe("saving a version's fields", () => {
  it("edits in place until something was sent, then forks", () => {
    expect(planFieldSave({ versionId: "v1", currentVersionId: "v1", sentCount: 0 })).toBe("update");
    expect(planFieldSave({ versionId: "v1", currentVersionId: "v1", sentCount: 3 })).toBe("fork");
    expect(planFieldSave({ versionId: "v1", currentVersionId: "v2", sentCount: 0 })).toBe("stale");
  });
});

describe("field geometry", () => {
  it("keeps boxes on the page and above the minimum size", () => {
    const b = clampBox({ x: 0.95, y: -0.2, w: 0.2, h: 0.0001 }, A4);
    expect(b.x + b.w).toBeLessThanOrEqual(1);
    expect(b.y).toBe(0);
    expect(b.h * A4.h).toBeCloseTo(MIN_SIZE_PT, 2);
  });

  it("creates a default-sized box centred on the drop point", () => {
    const f = newField("signature", 2, { x: 0.5, y: 0.5 }, A4, []);
    expect(f.page).toBe(2);
    expect(f.w * A4.w).toBeCloseTo(DEFAULT_SIZE_PT.signature[0], 2);
    expect(f.x + f.w / 2).toBeCloseTo(0.5, 5);
    expect(f.key).toBe("signature_1");
    expect(f.required).toBe(true);
  });

  it("gives choice fields starter options and checkboxes no requirement", () => {
    expect(newField("radio", 1, { x: 0.5, y: 0.5 }, A4, []).options).toEqual(["Option 1", "Option 2"]);
    expect(newField("checkbox", 1, { x: 0.5, y: 0.5 }, A4, []).required).toBe(false);
  });

  it("pins a box dropped at the edge inside the page", () => {
    const f = newField("textarea", 1, { x: 1, y: 1 }, A4, []);
    expect(f.x + f.w).toBeLessThanOrEqual(1);
    expect(f.y + f.h).toBeLessThanOrEqual(1);
  });
});

describe("keys", () => {
  it("picks the next free number", () => {
    expect(uniqueKey("text", ["text_1", "text_2"])).toBe("text_3");
    expect(uniqueKey("Client Sign!", [])).toBe("client_sign_1");
    expect(uniqueKey("123", [])).toBe("field_1");
    expect(keyForMergeKey("client.full_name", ["client_full_name_1"])).toBe("client_full_name_2");
  });

  it("recognises auto-generated keys only", () => {
    expect(isAutoKey("text_4", "text")).toBe(true);
    expect(isAutoKey("fee_amount", "text")).toBe(false);
    expect(isAutoKey("text_4", "date")).toBe(false);
  });
});

describe("copying and carrying fields", () => {
  it("copies to the listed pages, skipping its own, with unique keys", () => {
    const f = field({ key: "initial_1", type: "initial", page: 1 });
    const copies = copyFieldToPages(f, [1, 2, 3, 9], [A4, A4, A4], ["initial_1"]);
    expect(copies.map((c) => c.page)).toEqual([2, 3]);
    expect(copies.map((c) => c.key)).toEqual(["initial_p2_1", "initial_p3_1"]);
    expect(copies[0].x).toBe(f.x);
  });

  it("drops fields beyond a shorter new PDF and counts them", () => {
    const { kept, dropped } = carryFieldsForward([field({ page: 1 }), field({ page: 3 }), field({ page: 4 })], 3);
    expect(kept.map((f) => f.page)).toEqual([1, 3]);
    expect(dropped).toBe(1);
  });

  it("reads page lists the way people type them", () => {
    expect(parsePageList("all", 3)).toEqual([1, 2, 3]);
    expect(parsePageList(" 2-4, 1 ", 5)).toEqual([1, 2, 3, 4]);
    expect(parsePageList("6", 5)).toBeNull();
    expect(parsePageList("3-2", 5)).toBeNull();
    expect(parsePageList("two", 5)).toBeNull();
  });

  it("sorts into reading order", () => {
    const s = sortFields([field({ key: "b", page: 2, y: 0.1 }), field({ key: "c", page: 1, y: 0.5 }), field({ key: "a", page: 1, y: 0.1 })]);
    expect(s.map((f) => f.key)).toEqual(["a", "c", "b"]);
  });
});

describe("normalising and validating", () => {
  it("strips what a type cannot have", () => {
    const n = normalizeField(field({ type: "signature", mergeKey: "client.full_name", options: ["a"] }));
    expect(n.mergeKey).toBeNull();
    expect(n.options).toBeNull();
  });

  it("never requires a value the signer cannot change", () => {
    expect(normalizeField(field({ mergeKey: "client.email", required: true })).required).toBe(false);
  });

  it("accepts a sound layout", () => {
    expect(validateFields([field(), field({ key: "signature_1", type: "signature" })], 1)).toEqual([]);
  });

  it("names each problem", () => {
    const errors = validateFields(
      [
        field({ key: "dup", label: "Fee" }),
        field({ key: "dup" }),
        field({ key: "Bad Key" }),
        field({ key: "late", page: 3 }),
        field({ key: "wide", x: 0.9, w: 0.2 }),
        field({ key: "pick", type: "selection", options: ["Yes"] }),
        field({ key: "twice", type: "radio", options: ["A", "A"] }),
        field({ key: "ghost", mergeKey: "client.shoe_size" }),
        field({ key: "sig", type: "signature", mergeKey: "client.full_name" }),
      ],
      2,
    );
    expect(errors.join("\n")).toMatch(/share the key "dup"/);
    expect(errors.join("\n")).toMatch(/Bad Key/);
    expect(errors.join("\n")).toMatch(/page 3, but the PDF has 2/);
    expect(errors.join("\n")).toMatch(/wide on page 1 runs off the page/);
    expect(errors.join("\n")).toMatch(/pick needs at least two choices/);
    expect(errors.join("\n")).toMatch(/twice lists the same choice twice/);
    expect(errors.join("\n")).toMatch(/unknown merge key "client.shoe_size"/);
    expect(errors.join("\n")).toMatch(/signature cannot be filled from the CRM/);
  });

  it("warns, without blocking, when nobody signs", () => {
    expect(fieldWarnings([field()])).toEqual(["There is no signature box for the Client yet."]);
    expect(fieldWarnings([field({ type: "signature" }), field({ key: "d", role: "DESMA" })])).toEqual([
      "DESMA has fields to fill but no signature box.",
    ]);
  });
});

describe("merge keys", () => {
  it("covers the agreed list with unique keys", () => {
    expect(MERGE_KEY_SET.size).toBe(MERGE_KEYS.length);
    for (const k of [
      "client.full_name",
      "client.email",
      "client.phone",
      "client.address",
      "client.passport_no",
      "client.dob",
      "client.registration_no",
      "deal.service_name",
      "deal.fee_amount",
      "deal.fee_in_words",
      "deal.gst_amount",
      "deal.total_amount",
      "deal.installments",
      "today",
      "staff.name",
    ]) {
      expect(MERGE_KEY_SET.has(k)).toBe(true);
    }
  });
});
