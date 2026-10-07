import { describe, expect, it, vi } from "vitest";

const perms = vi.hoisted(() => ({ current: null as null | Record<string, unknown>, userId: "u1" as string | null }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: async () => ({ userId: perms.userId, perms: perms.current }),
}));

import { bankCaps, requireBank, BANK_PAGE } from "@/lib/bank/access";
import type { Permissions } from "@/lib/rbac";

const role = (p: Partial<Permissions>): Permissions => ({
  isAdmin: false,
  canApprove: false,
  needsApproval: true,
  draftFirst: false,
  pages: [],
  roleName: "Custom",
  ...p,
});

describe("bank statements RBAC (TEST 10)", () => {
  it("an ordinary employee without the page grant gets nothing", () => {
    expect(bankCaps(role({ pages: ["/finance/overview", "/finance/expenses", "/me/home"] }))).toEqual({
      view: false,
      download: false,
      reconcile: false,
      manage: false,
    });
  });

  it("other Finance pages never imply bank access", () => {
    expect(bankCaps(role({ pages: ["/finance/cashflow", "/finance/documents", "/finance/approvals"], canApprove: true })).view).toBe(false);
  });

  it("an executive granted the page can view and download, not reconcile or manage", () => {
    expect(bankCaps(role({ pages: [BANK_PAGE] }))).toEqual({ view: true, download: true, reconcile: false, manage: false });
  });

  it("a role that posts without approval can reconcile", () => {
    expect(bankCaps(role({ pages: [BANK_PAGE], needsApproval: false })).reconcile).toBe(true);
  });

  it("a Finance approver with the grant can manage the automation", () => {
    expect(bankCaps(role({ pages: [BANK_PAGE], canApprove: true, needsApproval: false }))).toEqual({
      view: true,
      download: true,
      reconcile: true,
      manage: true,
    });
  });

  it("Admin gets everything", () => {
    expect(bankCaps(role({ isAdmin: true }))).toEqual({ view: true, download: true, reconcile: true, manage: true });
  });

  it("the API guard answers 401 signed-out and 403 without the capability", async () => {
    perms.userId = null;
    perms.current = null;
    await expect(requireBank("view")).rejects.toMatchObject({ status: 401 });
    perms.userId = "u1";
    perms.current = role({ pages: ["/finance/overview"] });
    await expect(requireBank("view")).rejects.toMatchObject({ status: 403 });
    perms.current = role({ pages: [BANK_PAGE] });
    await expect(requireBank("manage")).rejects.toMatchObject({ status: 403 });
    await expect(requireBank("download")).resolves.toMatchObject({ userId: "u1" });
  });
});
