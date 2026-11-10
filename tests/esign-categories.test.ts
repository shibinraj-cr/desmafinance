/**
 * Agreement template categories — pure rules and routes.
 *
 * Pinned here:
 *   1. ACCESS — template managers and the Operations-manager tier manage
 *      categories; the plain Agreements grant does not.
 *   2. NAMES — unique ignoring case; a rename is applied to every template in
 *      the category in the same transaction.
 *   3. ORDER — a move renumbers the list 0..n-1 and writes only what changed.
 *   4. DELETE — only a category no template uses, archived templates included.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permissions } from "@/lib/rbac";

vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
    esignTemplate: { count: vi.fn(), updateMany: vi.fn() },
    esignTemplateCategory: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  canManageAgreementCategories,
  categoryChoices,
  cleanCategoryName,
  moveCategory,
} from "@/lib/esign/categories";
import { POST as createPost } from "@/app/api/esign/categories/route";
import { DELETE as categoryDelete, PATCH as categoryPatch } from "@/app/api/esign/categories/[id]/route";

const getPerms = getCurrentUserAndPermissions as unknown as ReturnType<typeof vi.fn>;
const m = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function perms(partial: Partial<Permissions> = {}): Permissions {
  return { isAdmin: false, canApprove: false, needsApproval: true, draftFirst: false, pages: [], roleName: "User", ...partial };
}

const asOpsManager = () =>
  getPerms.mockResolvedValue({
    userId: "u1",
    perms: perms({ roleName: "Operations Manager", pages: ["/operations/projects", "/operations/settings"] }),
  });

function json(url: string, method: string, body?: unknown) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = { params: { id: "c1" } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canManageAgreementCategories", () => {
  it("lets template managers, Operations managers and admins in", () => {
    expect(canManageAgreementCategories("u1", perms({ pages: ["/operations/agreements/templates"] }))).toBe(true);
    expect(canManageAgreementCategories("u1", perms({ pages: ["/operations/settings"] }))).toBe(true);
    expect(canManageAgreementCategories("u1", perms({ isAdmin: true }))).toBe(true);
  });

  it("keeps out roles that only send agreements or work operations", () => {
    expect(canManageAgreementCategories("u1", perms({ pages: ["/operations/agreements"] }))).toBe(false);
    expect(canManageAgreementCategories("u1", perms({ pages: ["/operations/projects", "/operations/my-work"] }))).toBe(false);
    expect(canManageAgreementCategories("u1", null)).toBe(false);
  });
});

describe("cleanCategoryName", () => {
  it("tidies whitespace and refuses blanks", () => {
    expect(cleanCategoryName("  UK \t Agreement\n")).toBe("UK Agreement");
    expect(cleanCategoryName("AHPRA/NMBA")).toBe("AHPRA/NMBA");
    expect(cleanCategoryName("   ")).toBeNull();
  });
});

describe("categoryChoices", () => {
  const list = [
    { name: "AHPRA Agreement", active: true },
    { name: "Agent", active: false },
    { name: "Sales", active: true },
  ];

  it("offers the active categories in order", () => {
    expect(categoryChoices(list, "Sales").map((c) => c.name)).toEqual(["AHPRA Agreement", "Sales"]);
    expect(categoryChoices(list).map((c) => c.name)).toEqual(["AHPRA Agreement", "Sales"]);
  });

  it("keeps a template's own archived or missing category on offer", () => {
    expect(categoryChoices(list, "Agent")).toEqual([...list.filter((c) => c.active), { name: "Agent", active: false }]);
    expect(categoryChoices(list, "Gone").at(-1)).toEqual({ name: "Gone", active: false });
  });
});

describe("moveCategory", () => {
  it("swaps with the neighbour, and stays put at either end", () => {
    expect(moveCategory(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveCategory(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveCategory(["a", "b", "c"], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveCategory(["a", "b", "c"], "c", "down")).toEqual(["a", "b", "c"]);
    expect(moveCategory(["a", "b"], "x", "up")).toEqual(["a", "b"]);
  });
});

describe("access", () => {
  const calls = () => [
    () => createPost(json("/api/esign/categories", "POST", { name: "UK Agreement" })),
    () => categoryPatch(json("/api/esign/categories/c1", "PATCH", { active: false }), ctx),
    () => categoryDelete(json("/api/esign/categories/c1", "DELETE"), ctx),
  ];

  it("401s without a session", async () => {
    getPerms.mockResolvedValue({ userId: null, perms: null });
    for (const call of calls()) expect((await call()).status).toBe(401);
  });

  it("403s a role that only sends agreements, before reading anything", async () => {
    getPerms.mockResolvedValue({ userId: "u1", perms: perms({ pages: ["/operations/agreements"] }) });
    for (const call of calls()) expect((await call()).status).toBe(403);
    expect(m(prisma.esignTemplateCategory.findFirst)).not.toHaveBeenCalled();
    expect(m(prisma.esignTemplateCategory.findUnique)).not.toHaveBeenCalled();
  });

  it("lets an Operations manager in without the templates grant", async () => {
    asOpsManager();
    m(prisma.esignTemplateCategory.findUnique).mockResolvedValue(null);
    const res = await categoryPatch(json("/api/esign/categories/c1", "PATCH", { active: false }), ctx);
    expect(res.status).toBe(404);
  });
});

describe("POST", () => {
  it("adds a category at the end of the list", async () => {
    asOpsManager();
    m(prisma.esignTemplateCategory.findFirst).mockResolvedValue(null);
    m(prisma.esignTemplateCategory.aggregate).mockResolvedValue({ _max: { sortOrder: 7 } });
    m(prisma.esignTemplateCategory.create).mockResolvedValue({ id: "c9", name: "UK Agreement", active: true });
    const res = await createPost(json("/api/esign/categories", "POST", { name: "  UK  Agreement " }));
    expect(res.status).toBe(201);
    expect(m(prisma.esignTemplateCategory.create).mock.calls[0][0].data).toEqual({ name: "UK Agreement", sortOrder: 8 });
  });

  it("refuses a name that exists in another case", async () => {
    asOpsManager();
    m(prisma.esignTemplateCategory.findFirst).mockResolvedValue({ id: "c5", name: "Sales", active: true });
    const res = await createPost(json("/api/esign/categories", "POST", { name: "sales" }));
    expect(res.status).toBe(409);
    expect(m(prisma.esignTemplateCategory.findFirst).mock.calls[0][0].where.name).toEqual({ equals: "sales", mode: "insensitive" });
    expect(m(prisma.esignTemplateCategory.create)).not.toHaveBeenCalled();
  });

  it("refuses a blank or over-long name", async () => {
    asOpsManager();
    expect((await createPost(json("/api/esign/categories", "POST", { name: "  " }))).status).toBe(400);
    expect((await createPost(json("/api/esign/categories", "POST", { name: "x".repeat(81) }))).status).toBe(400);
    expect(m(prisma.esignTemplateCategory.create)).not.toHaveBeenCalled();
  });
});

describe("PATCH", () => {
  const existing = { id: "c1", name: "NZ Agreement", active: true };

  it("renames the category and every template in it together", async () => {
    asOpsManager();
    m(prisma.esignTemplateCategory.findUnique).mockResolvedValue(existing);
    m(prisma.esignTemplateCategory.findFirst).mockResolvedValue(null);
    m(prisma.esignTemplateCategory.update).mockResolvedValue({ ...existing, name: "New Zealand Agreement" });
    m(prisma.esignTemplate.updateMany).mockResolvedValue({ count: 3 });
    const res = await categoryPatch(json("/api/esign/categories/c1", "PATCH", { name: "New Zealand Agreement" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).templatesRenamed).toBe(3);
    expect(m(prisma.$transaction)).toHaveBeenCalledTimes(1);
    expect(m(prisma.esignTemplate.updateMany).mock.calls[0][0]).toEqual({
      where: { category: "NZ Agreement" },
      data: { category: "New Zealand Agreement" },
    });
    expect(m(prisma.esignTemplateCategory.findFirst).mock.calls[0][0].where.id).toEqual({ not: "c1" });
  });

  it("refuses a rename onto another category's name", async () => {
    asOpsManager();
    m(prisma.esignTemplateCategory.findUnique).mockResolvedValue(existing);
    m(prisma.esignTemplateCategory.findFirst).mockResolvedValue({ id: "c2", name: "Sales", active: true });
    const res = await categoryPatch(json("/api/esign/categories/c1", "PATCH", { name: "SALES" }), ctx);
    expect(res.status).toBe(409);
    expect(m(prisma.$transaction)).not.toHaveBeenCalled();
  });

  it("archives without touching templates", async () => {
    asOpsManager();
    m(prisma.esignTemplateCategory.findUnique).mockResolvedValue(existing);
    m(prisma.esignTemplateCategory.update).mockResolvedValue({ ...existing, active: false });
    const res = await categoryPatch(json("/api/esign/categories/c1", "PATCH", { active: false }), ctx);
    expect(res.status).toBe(200);
    expect(m(prisma.esignTemplateCategory.update).mock.calls[0][0].data).toEqual({ active: false });
    expect(m(prisma.esignTemplate.updateMany)).not.toHaveBeenCalled();
  });

  it("moves by renumbering, writing only the rows whose position changed", async () => {
    asOpsManager();
    m(prisma.esignTemplateCategory.findUnique).mockResolvedValue({ ...existing, id: "c3" });
    m(prisma.esignTemplateCategory.findMany).mockResolvedValue([
      { id: "c1", sortOrder: 0 },
      { id: "c2", sortOrder: 1 },
      { id: "c3", sortOrder: 2 },
      { id: "c4", sortOrder: 3 },
    ]);
    m(prisma.esignTemplateCategory.update).mockResolvedValue({});
    const res = await categoryPatch(json("/api/esign/categories/c3", "PATCH", { move: "up" }), { params: { id: "c3" } });
    expect(res.status).toBe(200);
    expect(m(prisma.esignTemplateCategory.update).mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "c3" }, data: { sortOrder: 1 } },
      { where: { id: "c2" }, data: { sortOrder: 2 } },
    ]);
  });

  it("takes one change per call", async () => {
    asOpsManager();
    const res = await categoryPatch(json("/api/esign/categories/c1", "PATCH", { name: "X", active: false }), ctx);
    expect(res.status).toBe(400);
    expect(m(prisma.esignTemplateCategory.findUnique)).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("refuses a category any template uses, archived ones included", async () => {
    asOpsManager();
    m(prisma.esignTemplateCategory.findUnique).mockResolvedValue({ name: "Agent" });
    m(prisma.esignTemplate.count).mockResolvedValue(2);
    const res = await categoryDelete(json("/api/esign/categories/c1", "DELETE"), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("in_use");
    expect(m(prisma.esignTemplate.count).mock.calls[0][0]).toEqual({ where: { category: "Agent" } });
    expect(m(prisma.esignTemplateCategory.delete)).not.toHaveBeenCalled();
  });

  it("deletes an unused category", async () => {
    asOpsManager();
    m(prisma.esignTemplateCategory.findUnique).mockResolvedValue({ name: "Promotional" });
    m(prisma.esignTemplate.count).mockResolvedValue(0);
    const res = await categoryDelete(json("/api/esign/categories/c1", "DELETE"), ctx);
    expect(res.status).toBe(200);
    expect(m(prisma.esignTemplateCategory.delete).mock.calls[0][0]).toEqual({ where: { id: "c1" } });
  });
});
