/**
 * Route-level tests for agreement templates.
 *
 * Pinned here:
 *   1. ACCESS — every template route needs a session (401) and the
 *      /operations/agreements/templates page grant (403) before touching data.
 *   2. PARTIAL UPDATES — archiving sends only `active`; nothing else is cleared.
 *   3. ARCHIVED TEMPLATES — accept a restore and nothing else.
 *   4. LAYOUT CHECKS — an invalid layout is refused before any write.
 *   5. FILE SERVING — versions are found through their template, and an
 *      unsatisfiable range is answered 416 without touching storage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permissions } from "@/lib/rbac";

vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    esignTemplate: { findUnique: vi.fn(), update: vi.fn() },
    esignTemplateVersion: { findFirst: vi.fn() },
  },
}));

vi.mock("@vercel/blob", () => ({
  get: vi.fn(),
  head: vi.fn(),
  del: vi.fn(),
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { get, head } from "@vercel/blob";
import { POST as createPost } from "@/app/api/esign/templates/route";
import { PATCH as templatePatch } from "@/app/api/esign/templates/[id]/route";
import { PUT as fieldsPut } from "@/app/api/esign/templates/[id]/versions/[versionId]/fields/route";
import { GET as fileGet } from "@/app/api/esign/templates/[id]/versions/[versionId]/file/route";
import { POST as uploadPost } from "@/app/api/esign/upload/route";

const getPerms = getCurrentUserAndPermissions as unknown as ReturnType<typeof vi.fn>;
const m = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function perms(partial: Partial<Permissions> = {}): Permissions {
  return { isAdmin: false, canApprove: false, needsApproval: true, draftFirst: false, pages: [], roleName: "User", ...partial };
}

const granted = () => getPerms.mockResolvedValue({ userId: "u1", perms: perms({ pages: ["/operations/agreements/templates"] }) });

function json(url: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const field = {
  key: "signature_1",
  label: null,
  type: "signature",
  role: "Client",
  page: 1,
  x: 0.1,
  y: 0.8,
  w: 0.3,
  h: 0.06,
  required: true,
  options: null,
  mergeKey: null,
  fontSize: 11,
  alignment: "left",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("access", () => {
  const calls = () => [
    () => createPost(json("/api/esign/templates", "POST", { name: "A", category: "Sales", pathname: "esign/templates/a.pdf", fileName: "a.pdf" })),
    () => templatePatch(json("/api/esign/templates/t1", "PATCH", { active: false }), { params: { id: "t1" } }),
    () => fieldsPut(json("/api/esign/templates/t1/versions/v1/fields", "PUT", { fields: [], expectedUpdatedAt: null }), { params: { id: "t1", versionId: "v1" } }),
    () => fileGet(new Request("http://localhost/api/esign/templates/t1/versions/v1/file"), { params: { id: "t1", versionId: "v1" } }),
  ];

  it("401s without a session", async () => {
    getPerms.mockResolvedValue({ userId: null, perms: null });
    for (const call of calls()) expect((await call()).status).toBe(401);
  });

  it("403s without the page grant, before reading anything", async () => {
    getPerms.mockResolvedValue({ userId: "u1", perms: perms({ pages: ["/operations/templates"] }) });
    for (const call of calls()) expect((await call()).status).toBe(403);
    expect(m(prisma.esignTemplate.findUnique)).not.toHaveBeenCalled();
    expect(m(prisma.esignTemplateVersion.findFirst)).not.toHaveBeenCalled();
    expect(m(prisma.$transaction)).not.toHaveBeenCalled();
  });

  it("lets admins through without a grant", async () => {
    getPerms.mockResolvedValue({ userId: "u1", perms: perms({ isAdmin: true }) });
    m(prisma.esignTemplate.findUnique).mockResolvedValue(null);
    const res = await templatePatch(json("/api/esign/templates/t1", "PATCH", { active: false }), { params: { id: "t1" } });
    expect(res.status).toBe(404);
  });
});

describe("PATCH settings", () => {
  it("archiving changes only `active`", async () => {
    granted();
    m(prisma.esignTemplate.findUnique).mockResolvedValue({ active: true });
    m(prisma.esignTemplate.update).mockResolvedValue({ id: "t1", active: false, updatedAt: new Date() });
    const res = await templatePatch(json("/api/esign/templates/t1", "PATCH", { active: false }), { params: { id: "t1" } });
    expect(res.status).toBe(200);
    expect(m(prisma.esignTemplate.update).mock.calls[0][0].data).toEqual({ active: false });
  });

  it("an archived template accepts a restore but not edits", async () => {
    granted();
    m(prisma.esignTemplate.findUnique).mockResolvedValue({ active: false });
    const edit = await templatePatch(json("/api/esign/templates/t1", "PATCH", { name: "New" }), { params: { id: "t1" } });
    expect(edit.status).toBe(409);
    m(prisma.esignTemplate.update).mockResolvedValue({ id: "t1", active: true, updatedAt: new Date() });
    const restore = await templatePatch(json("/api/esign/templates/t1", "PATCH", { active: true }), { params: { id: "t1" } });
    expect(restore.status).toBe(200);
  });

  it("refuses a blank name", async () => {
    granted();
    m(prisma.esignTemplate.findUnique).mockResolvedValue({ active: true });
    const res = await templatePatch(json("/api/esign/templates/t1", "PATCH", { name: "   " }), { params: { id: "t1" } });
    expect(res.status).toBe(400);
    expect(m(prisma.esignTemplate.update)).not.toHaveBeenCalled();
  });
});

describe("PUT fields", () => {
  const put = (fields: unknown[]) =>
    fieldsPut(json("/api/esign/templates/t1/versions/v1/fields", "PUT", { fields, expectedUpdatedAt: null }), {
      params: { id: "t1", versionId: "v1" },
    });

  it("refuses a layout that runs off the PDF, before any write", async () => {
    granted();
    m(prisma.esignTemplateVersion.findFirst).mockResolvedValue({ id: "v1", version: 1, numPages: 1 });
    const res = await put([{ ...field, page: 2 }]);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toMatch(/page 2, but the PDF has 1/);
    expect(m(prisma.$transaction)).not.toHaveBeenCalled();
  });

  it("refuses malformed fields at the schema", async () => {
    granted();
    const res = await put([{ ...field, x: 1.5 }]);
    expect(res.status).toBe(400);
    expect(m(prisma.$transaction)).not.toHaveBeenCalled();
  });

  it("404s a version that is not this template's", async () => {
    granted();
    m(prisma.esignTemplateVersion.findFirst).mockResolvedValue(null);
    expect((await put([field])).status).toBe(404);
    expect(m(prisma.esignTemplateVersion.findFirst).mock.calls[0][0].where).toEqual({ id: "v1", templateId: "t1" });
  });
});

describe("GET file", () => {
  it("looks the version up through its template", async () => {
    granted();
    m(prisma.esignTemplateVersion.findFirst).mockResolvedValue(null);
    const res = await fileGet(new Request("http://localhost/x"), { params: { id: "t1", versionId: "v9" } });
    expect(res.status).toBe(404);
    expect(m(prisma.esignTemplateVersion.findFirst).mock.calls[0][0].where).toEqual({ id: "v9", templateId: "t1" });
  });

  it("answers an unsatisfiable range with 416 and no storage call", async () => {
    granted();
    m(prisma.esignTemplateVersion.findFirst).mockResolvedValue({ blobPathname: "esign/templates/a.pdf", fileName: "a.pdf", fileSize: 100 });
    const res = await fileGet(new Request("http://localhost/x", { headers: { range: "bytes=500-600" } }), {
      params: { id: "t1", versionId: "v1" },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */100");
    expect(m(get)).not.toHaveBeenCalled();
  });

  it("proxies a satisfiable range as 206", async () => {
    granted();
    m(prisma.esignTemplateVersion.findFirst).mockResolvedValue({ blobPathname: "esign/templates/a.pdf", fileName: "a.pdf", fileSize: 100 });
    m(get).mockResolvedValue({
      statusCode: 200,
      stream: new Response("0123456789").body,
      headers: new Headers({ "content-range": "bytes 0-9/100", "content-length": "10" }),
    });
    const res = await fileGet(new Request("http://localhost/x", { headers: { range: "bytes=0-9" } }), {
      params: { id: "t1", versionId: "v1" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-9/100");
    expect(await res.text()).toBe("0123456789");
    expect(m(get).mock.calls[0][1].headers).toEqual({ range: "bytes=0-9" });
  });
});

describe("create", () => {
  it("refuses an upload path outside the template prefix without reading storage", async () => {
    granted();
    m(prisma.esignTemplateVersion.findFirst).mockResolvedValue(null);
    const res = await createPost(
      json("/api/esign/templates", "POST", { name: "A", category: "Sales", pathname: "finance-docs/x.pdf", fileName: "x.pdf" }),
    );
    expect(res.status).toBe(400);
    expect(m(head)).not.toHaveBeenCalled();
  });

  it("refuses an unknown category", async () => {
    granted();
    const res = await createPost(
      json("/api/esign/templates", "POST", { name: "A", category: "Loans", pathname: "esign/templates/a.pdf", fileName: "a.pdf" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("upload token", () => {
  it("explains when storage is not configured", async () => {
    const saved = process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const res = await uploadPost(json("/api/esign/upload", "POST", {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("blob_not_configured");
    if (saved) process.env.BLOB_READ_WRITE_TOKEN = saved;
  });
});
