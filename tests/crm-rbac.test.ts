import { describe, it, expect, vi } from "vitest";

// canEditLead is pure, but the module imports getLeadPulseAccess → prisma.
// Mock prisma so importing the module never constructs a real DB client.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { canEditLead, type CrmAccess } from "@/lib/crm-rbac";

function access(partial: Partial<CrmAccess>): CrmAccess {
  return {
    userId: "u1",
    isAdmin: false,
    isBde: false,
    isSupervisor: false,
    bdeDisplayName: null,
    canViewLeads: true,
    canCreateLeads: false,
    canBulkImport: false,
    canBulkEmail: false,
    canAssign: false,
    canViewHistory: false,
    canManageSettings: false,
    ...partial,
  };
}

describe("canEditLead", () => {
  it("lets admins edit any lead", () => {
    expect(canEditLead(access({ isAdmin: true }), { assignedToId: "someone-else" }, "u1")).toBe(true);
    expect(canEditLead(access({ isAdmin: true }), { assignedToId: null }, "u1")).toBe(true);
  });

  it("lets a BDE edit only leads assigned to them", () => {
    expect(canEditLead(access({ isBde: true }), { assignedToId: "u1" }, "u1")).toBe(true);
  });

  it("blocks a BDE from editing another consultant's lead", () => {
    expect(canEditLead(access({ isBde: true }), { assignedToId: "u2" }, "u1")).toBe(false);
  });

  it("blocks a BDE from editing an unassigned lead", () => {
    expect(canEditLead(access({ isBde: true }), { assignedToId: null }, "u1")).toBe(false);
  });

  it("blocks non-admin non-BDE users (e.g. supervisors/viewers)", () => {
    expect(canEditLead(access({ isSupervisor: true }), { assignedToId: "u1" }, "u1")).toBe(false);
    expect(canEditLead(access({}), { assignedToId: "u1" }, "u1")).toBe(false);
  });
});
