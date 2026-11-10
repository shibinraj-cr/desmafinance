/**
 * PATCH /api/users/[id] — changing a login's email from the Users page.
 *
 * Pinned here: emails are unique, so a clash is answered 409 `email_taken`
 * (not a unique-constraint 500); blank removes the email; saved lowercased.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Permissions } from "@/lib/rbac";

vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    role: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { PATCH } from "@/app/api/users/[id]/route";

const m = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const admin: Permissions = { isAdmin: true, canApprove: true, needsApproval: false, draftFirst: false, pages: [], roleName: "Admin" };
const target = { id: "u2", username: "staff1", email: null, role: "executive", isActive: true, roleRef: null };
const saved = { id: "u2", username: "staff1", email: null, role: "executive", roleId: null, isActive: true, roleRef: null, updatedAt: new Date() };

const patch = (body: unknown) =>
  PATCH(
    new NextRequest("http://localhost/api/users/u2", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: { id: "u2" } },
  );

beforeEach(() => {
  vi.clearAllMocks();
  m(getCurrentUserAndPermissions).mockResolvedValue({ userId: "u1", perms: admin });
});

describe("PATCH /api/users/[id] email", () => {
  it("adds an email, lowercased", async () => {
    m(prisma.user.findUnique).mockImplementation(async (a: { where: { id?: string } }) => (a.where.id ? target : null));
    m(prisma.user.update).mockResolvedValue({ ...saved, email: "staff1@desma.test" });
    const res = await patch({ email: "Staff1@Desma.Test" });
    expect(res.status).toBe(200);
    expect(m(prisma.user.update).mock.calls[0][0].data).toEqual({ email: "staff1@desma.test" });
  });

  it("refuses an email another login has, without writing", async () => {
    m(prisma.user.findUnique).mockImplementation(async (a: { where: { id?: string } }) =>
      a.where.id ? target : { id: "u9" },
    );
    const res = await patch({ email: "taken@desma.test" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("email_taken");
    expect(m(prisma.user.update)).not.toHaveBeenCalled();
  });

  it("blank removes the email", async () => {
    m(prisma.user.findUnique).mockResolvedValue({ ...target, email: "old@desma.test" });
    m(prisma.user.update).mockResolvedValue(saved);
    const res = await patch({ email: "" });
    expect(res.status).toBe(200);
    expect(m(prisma.user.update).mock.calls[0][0].data).toEqual({ email: null });
    expect(m(prisma.user.findUnique)).toHaveBeenCalledTimes(1);
  });

  it("refuses something that is not an email", async () => {
    const res = await patch({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(m(prisma.user.update)).not.toHaveBeenCalled();
  });
});
