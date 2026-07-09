import { describe, it, expect, vi } from "vitest";

// canEditLead is pure, but the module imports getLeadPulseAccess → prisma.
// Mock prisma so importing the module never constructs a real DB client.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// getCrmAccess calls getLeadPulseAccess (which hits prisma). Stub it to a plain
// non-BDE viewer so these tests isolate the page-marker → capability logic.
vi.mock("@/lib/lead-pulse-rbac", () => ({
  getLeadPulseAccess: vi.fn(async () => ({
    role: null,
    displayName: null,
    canSubmitEntries: false,
  })),
}));

import {
  canEditLead,
  getCrmAccess,
  CRM_ASSIGN_PAGE,
  CRM_HISTORY_PAGE,
  CRM_TEAM_LEAD_PAGE,
  type CrmAccess,
} from "@/lib/crm-rbac";
import type { Permissions } from "@/lib/rbac";

function perms(pages: string[], isAdmin = false): Permissions {
  return {
    isAdmin,
    canApprove: false,
    needsApproval: false,
    draftFirst: false,
    pages,
    roleName: "Test",
  };
}

function access(partial: Partial<CrmAccess>): CrmAccess {
  return {
    userId: "u1",
    isAdmin: false,
    isBde: false,
    isSupervisor: false,
    isCrmTeamLead: false,
    canManageCrm: false,
    canManageTemplates: false,
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

  it("lets a Lead Pulse supervisor edit any lead", () => {
    expect(canEditLead(access({ isSupervisor: true }), { assignedToId: "someone-else" }, "u1")).toBe(true);
    expect(canEditLead(access({ isSupervisor: true }), { assignedToId: null }, "u1")).toBe(true);
  });

  it("blocks plain viewers (no admin/supervisor/BDE rights)", () => {
    expect(canEditLead(access({}), { assignedToId: "u1" }, "u1")).toBe(false);
  });
});

describe("getCrmAccess narrow capability markers", () => {
  it("grants assign (only) via the CRM_ASSIGN_PAGE marker", async () => {
    const a = await getCrmAccess("u1", perms([CRM_ASSIGN_PAGE]));
    expect(a.canAssign).toBe(true);
    // ...without leaking the rest of the CRM-admin tier.
    expect(a.canManageCrm).toBe(false);
    expect(a.canBulkImport).toBe(false);
    expect(a.canBulkEmail).toBe(false);
    expect(a.canViewHistory).toBe(false);
    expect(a.canManageSettings).toBe(false);
  });

  it("grants History (only) via the CRM_HISTORY_PAGE marker", async () => {
    const a = await getCrmAccess("u1", perms([CRM_HISTORY_PAGE]));
    expect(a.canViewHistory).toBe(true);
    expect(a.canAssign).toBe(false);
    expect(a.canManageCrm).toBe(false);
    expect(a.canManageSettings).toBe(false);
  });

  it("grants assign + History together (the sales-team-lead case)", async () => {
    const a = await getCrmAccess("u1", perms([CRM_ASSIGN_PAGE, CRM_HISTORY_PAGE]));
    expect(a.canAssign).toBe(true);
    expect(a.canViewHistory).toBe(true);
    // Still not a full CRM admin: no import / bulk email / settings.
    expect(a.canManageCrm).toBe(false);
    expect(a.canBulkImport).toBe(false);
    expect(a.canBulkEmail).toBe(false);
    expect(a.canManageSettings).toBe(false);
  });

  it("the view-only team-lead marker alone grants neither assign nor History", async () => {
    const a = await getCrmAccess("u1", perms([CRM_TEAM_LEAD_PAGE]));
    expect(a.isCrmTeamLead).toBe(true);
    expect(a.canAssign).toBe(false);
    expect(a.canViewHistory).toBe(false);
  });

  it("full CRM admins (/crm/settings) still get assign + History", async () => {
    const a = await getCrmAccess("u1", perms(["/crm/settings"]));
    expect(a.canManageCrm).toBe(true);
    expect(a.canAssign).toBe(true);
    expect(a.canViewHistory).toBe(true);
  });

  it("system admins get assign + History", async () => {
    const a = await getCrmAccess("u1", perms([], true));
    expect(a.canAssign).toBe(true);
    expect(a.canViewHistory).toBe(true);
  });
});
