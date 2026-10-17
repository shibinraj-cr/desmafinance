/**
 * Route-level tests for sending agreements.
 *
 * Pinned here:
 *   1. ACCESS — the Agreements grant is required; the template-editor grant
 *      alone does not let anyone send.
 *   2. THE SENDING SWITCH — while it is off, a send is refused before any PDF
 *      is stamped or stored, and resends are refused too; drafts still save.
 *   3. ADMIN-ONLY SWITCH — only an admin may turn sending on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permissions } from "@/lib/rbac";

vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

const tx = {
  esignRequest: { create: vi.fn(), update: vi.fn() },
  esignSigner: { deleteMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  esignEvent: { create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    user: { findUnique: vi.fn(async () => ({ email: "staff@example.com", username: "staff" })) },
    lead: { findUnique: vi.fn() },
    esignTemplateVersion: { findUnique: vi.fn() },
    esignRequest: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/app-settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), head: vi.fn(), del: vi.fn(), issueSignedToken: vi.fn(), presignUrl: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/app-settings";
import { get, put } from "@vercel/blob";
import { POST as createPost } from "@/app/api/esign/requests/route";
import { PUT as sendingPut } from "@/app/api/esign/settings/sending/route";
import { POST as resendPost } from "@/app/api/esign/requests/[id]/resend/route";
import { POST as cancelPost } from "@/app/api/esign/requests/[id]/cancel/route";

const m = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const getPerms = m(getCurrentUserAndPermissions);

function perms(partial: Partial<Permissions> = {}): Permissions {
  return { isAdmin: false, canApprove: false, needsApproval: true, draftFirst: false, pages: [], roleName: "User", ...partial };
}
const sender = () => getPerms.mockResolvedValue({ userId: "u1", perms: perms({ pages: ["/operations/agreements"] }) });

function json(url: string, method: string, body: unknown) {
  return new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

const version = {
  id: "v1",
  version: 1,
  blobPathname: "esign/templates/a.pdf",
  template: { id: "t1", name: "AHPRA Agreement", category: "AHPRA Agreement", active: true, currentVersionId: "v1" },
  fields: [
    { key: "client_full_name_1", label: null, type: "text", role: "Client", page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.03, required: false, options: null, mergeKey: "client.full_name", fontSize: 11, alignment: "left" },
    { key: "signature_1", label: null, type: "signature", role: "Client", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.06, required: true, options: null, mergeKey: null, fontSize: 11, alignment: "left" },
    { key: "signature_2", label: null, type: "signature", role: "DESMA", page: 1, x: 0.6, y: 0.8, w: 0.3, h: 0.06, required: true, options: null, mergeKey: null, fontSize: 11, alignment: "left" },
  ],
};

const body = (action: "draft" | "send") => ({
  leadId: "l1",
  templateVersionId: "v1",
  mergeData: { "client.full_name": "Test Client" },
  signers: [
    { role: "Client", name: "Test Client", email: "client@example.com", phone: null, signOrder: 1 },
    { role: "DESMA", name: "Staff", email: "staff@example.com", phone: null, signOrder: 2 },
  ],
  cc: [],
  expiresInDays: 14,
  reminderDays: 3,
  action,
});

beforeEach(() => {
  vi.clearAllMocks();
  m(prisma.esignTemplateVersion.findUnique).mockResolvedValue(version);
  m(prisma.lead.findUnique).mockResolvedValue({ id: "l1", candidateName: "Test Client" });
  m(prisma.user.findUnique).mockResolvedValue({ email: "staff@example.com", username: "staff" });
  tx.esignRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "r1", ...data }));
});

describe("access", () => {
  it("401s without a session", async () => {
    getPerms.mockResolvedValue({ userId: null, perms: null });
    expect((await createPost(json("/api/esign/requests", "POST", body("draft")))).status).toBe(401);
  });

  it("the template-editor grant alone cannot send", async () => {
    getPerms.mockResolvedValue({ userId: "u1", perms: perms({ pages: ["/operations/agreements/templates"] }) });
    expect((await createPost(json("/api/esign/requests", "POST", body("draft")))).status).toBe(403);
    expect(m(prisma.esignTemplateVersion.findUnique)).not.toHaveBeenCalled();
  });
});

describe("the sending switch", () => {
  it("refuses a send while off, before stamping or storing anything", async () => {
    sender();
    m(getSetting).mockResolvedValue(null);
    const res = await createPost(json("/api/esign/requests", "POST", body("send")));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("sending_disabled");
    expect(m(get)).not.toHaveBeenCalled();
    expect(m(put)).not.toHaveBeenCalled();
    expect(m(prisma.$transaction)).not.toHaveBeenCalled();
  });

  it("still saves drafts, logging their creation", async () => {
    sender();
    m(getSetting).mockResolvedValue(null);
    const res = await createPost(json("/api/esign/requests", "POST", body("draft")));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ requestId: "r1", status: "draft", delivery: [] });
    expect(tx.esignRequest.create.mock.calls[0][0].data).toMatchObject({
      status: "draft",
      reference: "AHPRA Agreement – Test Client",
      mergeData: { "client.full_name": "Test Client" },
      createdById: "u1",
    });
    // Asked for Client first; stored with DESMA first.
    expect(tx.esignSigner.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ role: "Client", email: "client@example.com", signOrder: 2 }),
      expect.objectContaining({ role: "DESMA", email: "staff@example.com", signOrder: 1 }),
    ]);
    expect(tx.esignEvent.create.mock.calls[0][0].data).toMatchObject({ requestId: "r1", action: "created", actor: "staff@example.com" });
  });

  it("refuses an incomplete send with the reasons", async () => {
    sender();
    m(getSetting).mockResolvedValue("true");
    const res = await createPost(json("/api/esign/requests", "POST", { ...body("send"), mergeData: {} }));
    expect(res.status).toBe(422);
    expect((await res.json()).message).toMatch(/Fill in: client.full_name/);
  });

  it("refuses a stale template version", async () => {
    sender();
    m(prisma.esignTemplateVersion.findUnique).mockResolvedValue({ ...version, template: { ...version.template, currentVersionId: "v2" } });
    const res = await createPost(json("/api/esign/requests", "POST", body("draft")));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_version");
  });

  it("refuses resends while off", async () => {
    sender();
    m(getSetting).mockResolvedValue(null);
    m(prisma.esignRequest.findUnique).mockResolvedValue({
      id: "r1",
      status: "sent",
      expiresAt: new Date(Date.now() + 86400000),
      signers: [{ id: "s1", name: "Test Client", status: "sent", signOrder: 1, tokenHash: "h" }],
    });
    const res = await resendPost(json("/api/esign/requests/r1/resend", "POST", { signerId: "s1" }), { params: { id: "r1" } });
    expect(res.status).toBe(409);
  });
});

describe("admin-only switch", () => {
  it("a non-admin sender cannot turn sending on", async () => {
    sender();
    const res = await sendingPut(json("/api/esign/settings/sending", "PUT", { enabled: true }));
    expect(res.status).toBe(403);
    expect(m(setSetting)).not.toHaveBeenCalled();
  });

  it("an admin can", async () => {
    getPerms.mockResolvedValue({ userId: "u9", perms: perms({ isAdmin: true }) });
    const res = await sendingPut(json("/api/esign/settings/sending", "PUT", { enabled: true }));
    expect(res.status).toBe(200);
    expect(m(setSetting)).toHaveBeenCalledWith("esign_sending_enabled", "true", "u9");
  });
});

describe("cancel", () => {
  it("needs a reason", async () => {
    sender();
    m(prisma.esignRequest.findUnique).mockResolvedValue({ id: "r1", status: "sent", signers: [] });
    const res = await cancelPost(json("/api/esign/requests/r1/cancel", "POST", { reason: "  " }), { params: { id: "r1" } });
    expect(res.status).toBe(400);
    expect(m(prisma.$transaction)).not.toHaveBeenCalled();
  });

  it("refuses an agreement that is already closed", async () => {
    sender();
    m(prisma.esignRequest.findUnique).mockResolvedValue({ id: "r1", status: "signed", signers: [] });
    const res = await cancelPost(json("/api/esign/requests/r1/cancel", "POST", { reason: "wrong client" }), { params: { id: "r1" } });
    expect(res.status).toBe(409);
  });
});
