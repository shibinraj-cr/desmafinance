/**
 * The reconciliation between our template rows and Meta's catalogue.
 *
 * These are the decisions that can lose work rather than merely display it
 * wrongly: whether an absent template means "deleted at Meta" or "we could not
 * read the catalogue", whether a rejection reason survives an approval, and
 * whether a failed submission is allowed to un-approve a live template.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    waTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/wa/registry", () => ({ getWaProvider: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getWaProvider } from "@/lib/wa/registry";
import { applyTemplateStatusUpdates, syncWaTemplatesFromMeta, parseSpec } from "@/lib/wa/templates";

const findMany = prisma.waTemplate.findMany as unknown as ReturnType<typeof vi.fn>;
const findFirst = prisma.waTemplate.findFirst as unknown as ReturnType<typeof vi.fn>;
const update = prisma.waTemplate.update as unknown as ReturnType<typeof vi.fn>;
const provider = getWaProvider as unknown as ReturnType<typeof vi.fn>;

function cloud(templates: unknown[]) {
  return {
    key: "cloud",
    label: "WhatsApp Cloud API",
    supports: (c: string) => c === "listTemplates" || c === "manageTemplates",
    listTemplates: vi.fn(async () => templates),
  };
}

function metaTemplate(over: Record<string, unknown> = {}) {
  return {
    id: "100",
    name: "follow_up",
    language: "en",
    category: "UTILITY",
    status: "APPROVED",
    body: "Hi {{1}}",
    header: null,
    variableCount: 1,
    rejectedReason: null,
    ...over,
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: "row1",
    name: "follow_up",
    language: "en",
    category: "UTILITY",
    metaId: "100",
    status: "PENDING",
    rejectedReason: null,
    lastError: null,
    spec: {},
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
});

describe("sync", () => {
  it("refuses when the transport cannot read the catalogue at all", async () => {
    provider.mockResolvedValue({ label: "Wabis", supports: () => false, listTemplates: vi.fn() });
    const out = await syncWaTemplatesFromMeta();
    expect(out.ok).toBe(false);
    expect(out.detail).toMatch(/Cloud API/);
    expect(update).not.toHaveBeenCalled();
  });

  it("changes nothing on an empty catalogue — a failed read and an empty WABA look identical", async () => {
    provider.mockResolvedValue(cloud([]));
    findMany.mockResolvedValue([row()]);
    const out = await syncWaTemplatesFromMeta();
    expect(out.ok).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it("carries Meta's verdict onto the local row", async () => {
    provider.mockResolvedValue(cloud([metaTemplate({ status: "REJECTED", rejectedReason: "INCORRECT_CATEGORY" })]));
    findMany.mockResolvedValue([row()]);

    const out = await syncWaTemplatesFromMeta();

    expect(out).toMatchObject({ ok: true, matched: 1, changed: 1, disappeared: 0 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "row1" },
        data: expect.objectContaining({ status: "REJECTED", rejectedReason: "INCORRECT_CATEGORY" }),
      }),
    );
  });

  it("matches on Meta's id first, so a template renamed there is still the same template", async () => {
    provider.mockResolvedValue(cloud([metaTemplate({ name: "follow_up_v2" })]));
    findMany.mockResolvedValue([row()]);

    const out = await syncWaTemplatesFromMeta();

    expect(out.matched).toBe(1);
    expect(out.metaOnly).toBe(0);
  });

  it("adopts the Meta id for a row that was matched by name", async () => {
    provider.mockResolvedValue(cloud([metaTemplate({ id: "555" })]));
    findMany.mockResolvedValue([row({ metaId: null })]);

    await syncWaTemplatesFromMeta();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metaId: "555" }) }),
    );
  });

  it("marks a template Meta no longer holds as DELETED rather than dropping the wording", async () => {
    provider.mockResolvedValue(cloud([metaTemplate({ id: "999", name: "something_else" })]));
    findMany.mockResolvedValue([row()]);

    const out = await syncWaTemplatesFromMeta();

    expect(out.disappeared).toBe(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "row1" },
      data: expect.objectContaining({ status: "DELETED" }),
    });
  });

  it("leaves a draft alone — Meta has never heard of it, so its absence means nothing", async () => {
    provider.mockResolvedValue(cloud([metaTemplate({ id: "999", name: "something_else" })]));
    findMany.mockResolvedValue([row({ metaId: null, status: "DRAFT" })]);

    const out = await syncWaTemplatesFromMeta();

    expect(out.disappeared).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("counts a catalogue template with no local row without importing it", async () => {
    provider.mockResolvedValue(cloud([metaTemplate({ id: "777", name: "written_in_meta" })]));
    findMany.mockResolvedValue([]);

    const out = await syncWaTemplatesFromMeta();

    expect(out.metaOnly).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("the status webhook, applied", () => {
  it("clears the old rejection reason when a template is approved", async () => {
    findFirst.mockResolvedValue(row({ status: "REJECTED", rejectedReason: "INVALID_FORMAT" }));

    const n = await applyTemplateStatusUpdates([
      { metaId: "100", name: "follow_up", language: "en", status: "APPROVED", reason: null, newCategory: null },
    ]);

    expect(n).toBe(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", rejectedReason: null }) }),
    );
  });

  it("ignores an update about a template we do not hold — the WABA is shared", async () => {
    findFirst.mockResolvedValue(null);
    const n = await applyTemplateStatusUpdates([
      { metaId: "abc", name: "someone_elses", language: "en", status: "APPROVED", reason: null, newCategory: null },
    ]);
    expect(n).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("applies a recategorisation without touching the approval status", async () => {
    findFirst.mockResolvedValue(row({ status: "APPROVED", category: "UTILITY" }));

    await applyTemplateStatusUpdates([
      { metaId: "100", name: "follow_up", language: "en", status: "UNKNOWN", reason: null, newCategory: "MARKETING" },
    ]);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED", category: "MARKETING" }) }),
    );
  });

  it("matches by name and language when Meta sends no id", async () => {
    findFirst.mockResolvedValue(row());
    await applyTemplateStatusUpdates([
      { metaId: null, name: "follow_up", language: "en", status: "APPROVED", reason: null, newCategory: null },
    ]);
    expect(findFirst).toHaveBeenCalledWith({ where: { OR: [{ name: "follow_up", language: "en" }] } });
  });

  it("skips an update that names nothing at all", async () => {
    const n = await applyTemplateStatusUpdates([
      { metaId: null, name: null, language: null, status: "APPROVED", reason: null, newCategory: null },
    ]);
    expect(n).toBe(0);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("reading a stored spec back", () => {
  it("returns null for a row whose JSON no longer matches the shape", () => {
    expect(parseSpec(null)).toBeNull();
    expect(parseSpec({ body: 42 })).toBeNull();
    expect(parseSpec([])).toBeNull();
  });

  it("fills in the halves an older row may not carry", () => {
    const spec = parseSpec({ name: "x", body: "hi" });
    expect(spec).toMatchObject({ name: "x", body: "hi", bodyExamples: [], buttons: [], category: "UTILITY" });
  });
});
