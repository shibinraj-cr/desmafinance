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

import { getLeadPulseAccess } from "@/lib/lead-pulse-rbac";
import {
  canEditLead,
  canAddTask,
  canEditTask,
  canAddNote,
  canEditNote,
  visibleTasksWhere,
  getCrmAccess,
  CRM_ASSIGN_PAGE,
  CRM_HISTORY_PAGE,
  CRM_TEAM_LEAD_PAGE,
  CRM_REFERRAL_LEADS_PAGE,
  CRM_ENROLLED_TASKS_PAGE,
  CRM_NOTES_ALL_PAGE,
  type CrmAccess,
} from "@/lib/crm-rbac";
import { CRM_LEADS_ONLY_PAGE, type Permissions } from "@/lib/rbac";
import { GRANTABLE_HREFS, ROLE_PERMISSIONS } from "@/lib/modules";

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
    referralLeadsOnly: false,
    canReEnroll: false,
    canTaskEnrolledLeads: false,
    ownTasksOnly: false,
    canNoteAnyLead: false,
    canBulkImport: false,
    canBulkEmail: false,
    canBulkStatus: false,
    canAssign: false,
    canViewHistory: false,
    canManageSettings: false,
    canUnenroll: false,
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

describe("canBulkStatus (bulk stage change on the Leads list)", () => {
  /** Swap the stubbed Lead Pulse role for the next getCrmAccess call only. */
  function nextLeadPulseRole(role: "l1" | "l2" | "supervisor") {
    vi.mocked(getLeadPulseAccess).mockResolvedValueOnce({
      role,
      displayName: "Test BDE",
      canSupervise: role === "supervisor",
      canSubmitEntries: role !== "supervisor",
      desfinAdmin: false,
    });
  }

  it("is granted to system admins", async () => {
    const a = await getCrmAccess("u1", perms([], true));
    expect(a.canBulkStatus).toBe(true);
  });

  it("is granted to a Lead Pulse supervisor — the Marketing Admin case", async () => {
    nextLeadPulseRole("supervisor");
    const a = await getCrmAccess("u1", perms(["/marketing/lead-pulse"]));
    expect(a.isSupervisor).toBe(true);
    expect(a.canBulkStatus).toBe(true);
    // Without promoting them to the CRM-admin tier (import / bulk email / settings).
    expect(a.canManageCrm).toBe(false);
    expect(a.canBulkEmail).toBe(false);
  });

  it("is withheld from a BDE, who may only edit their own leads", async () => {
    nextLeadPulseRole("l2");
    const a = await getCrmAccess("u1", perms([]));
    expect(a.isBde).toBe(true);
    expect(a.canBulkStatus).toBe(false);
  });

  it("is withheld from a CRM admin who can't edit an unassigned lead one at a time", async () => {
    const a = await getCrmAccess("u1", perms(["/crm/settings"]));
    expect(a.canBulkEmail).toBe(true);
    // They can bulk-email, but they're neither admin nor supervisor, so
    // canEditLead already refuses them an unassigned lead — bulk must too.
    expect(a.canBulkStatus).toBe(false);
    expect(canEditLead(a, { assignedToId: null }, "u1")).toBe(false);
  });

  it("never reaches further than canEditLead's edit-any arm", async () => {
    for (const a of [
      await getCrmAccess("u1", perms([], true)),
      await getCrmAccess("u1", perms(["/crm/settings"])),
      await getCrmAccess("u1", perms([CRM_ASSIGN_PAGE])),
    ]) {
      if (a.canBulkStatus) expect(canEditLead(a, { assignedToId: "someone-else" }, "u1")).toBe(true);
    }
  });
});

describe("referral leads marker (CRM_REFERRAL_LEADS_PAGE)", () => {
  function nextLeadPulseRole(role: "l1" | "l2") {
    vi.mocked(getLeadPulseAccess).mockResolvedValueOnce({
      role,
      displayName: "Test BDE",
      canSupervise: false,
      canSubmitEntries: true,
      desfinAdmin: false,
    });
  }

  it("lets a CRM viewer create leads, as referrals only, without re-enroll", async () => {
    const a = await getCrmAccess("u1", perms(["/crm/leads", CRM_REFERRAL_LEADS_PAGE]));
    expect(a.canCreateLeads).toBe(true);
    expect(a.referralLeadsOnly).toBe(true);
    // Re-enroll hands the new lead to its creator as a BDE — not this user.
    expect(a.canReEnroll).toBe(false);
    expect(a.canAssign).toBe(false);
    expect(a.canBulkImport).toBe(false);
  });

  it("is not a way into the CRM without the Leads page", async () => {
    const a = await getCrmAccess("u1", perms([CRM_REFERRAL_LEADS_PAGE]));
    expect(a.canViewLeads).toBe(false);
    expect(a.canCreateLeads).toBe(false);
    expect(a.referralLeadsOnly).toBe(false);
  });

  it("never narrows a BDE, who creates any kind of lead", async () => {
    nextLeadPulseRole("l2");
    const a = await getCrmAccess("u1", perms(["/crm/leads", CRM_REFERRAL_LEADS_PAGE]));
    expect(a.canCreateLeads).toBe(true);
    expect(a.referralLeadsOnly).toBe(false);
    expect(a.canReEnroll).toBe(true);
  });

  it("leaves a plain viewer unable to create", async () => {
    const a = await getCrmAccess("u1", perms(["/crm/leads"]));
    expect(a.canCreateLeads).toBe(false);
    expect(a.referralLeadsOnly).toBe(false);
  });
});

describe("enrolled-lead tasks (CRM_ENROLLED_TASKS_PAGE)", () => {
  const enrolled = { assignedToId: "bde-1", status: { code: "enrolled" } };
  const followUp = { assignedToId: "bde-1", status: { code: "follow_up" } };

  it("is granted with the Leads page, and not without it", async () => {
    expect((await getCrmAccess("u1", perms(["/crm/leads", CRM_ENROLLED_TASKS_PAGE]))).canTaskEnrolledLeads).toBe(true);
    expect((await getCrmAccess("u1", perms([CRM_ENROLLED_TASKS_PAGE]))).canTaskEnrolledLeads).toBe(false);
  });

  it("adds tasks to enrolled leads only", () => {
    const a = access({ canTaskEnrolledLeads: true });
    expect(canAddTask(a, enrolled, "u1")).toBe(true);
    expect(canAddTask(a, followUp, "u1")).toBe(false);
    expect(canAddTask(a, { assignedToId: null, status: null }, "u1")).toBe(false);
  });

  it("works only the tasks assigned to them, never the consultant's", () => {
    const a = access({ canTaskEnrolledLeads: true });
    expect(canEditTask(a, { assignedToId: "u1" }, enrolled, "u1")).toBe(true);
    expect(canEditTask(a, { assignedToId: "bde-1" }, enrolled, "u1")).toBe(false);
    // Their own task goes read-only once the lead is no longer enrolled.
    expect(canEditTask(a, { assignedToId: "u1" }, followUp, "u1")).toBe(false);
  });

  it("changes nothing for a plain viewer or for the lead's own BDE", () => {
    expect(canAddTask(access({}), enrolled, "u1")).toBe(false);
    const bde = access({ isBde: true });
    expect(canAddTask(bde, { ...followUp, assignedToId: "u1" }, "u1")).toBe(true);
    expect(canEditTask(bde, { assignedToId: "someone" }, { ...followUp, assignedToId: "u1" }, "u1")).toBe(true);
  });
});

describe("whole-team notes (CRM_NOTES_ALL_PAGE)", () => {
  const head = access({ isBde: true, canNoteAnyLead: true });

  it("grants only the note power — no edit rights on the lead", async () => {
    const a = await getCrmAccess("u1", perms(["/crm/leads", CRM_NOTES_ALL_PAGE]));
    expect(a.canNoteAnyLead).toBe(true);
    expect(canEditLead(a, { assignedToId: "u2" }, "u1")).toBe(false);
    expect(a.canAssign).toBe(false);
    expect(a.canBulkStatus).toBe(false);
  });

  it("is not a way into the CRM by itself", async () => {
    expect((await getCrmAccess("u1", perms([CRM_NOTES_ALL_PAGE]))).canNoteAnyLead).toBe(false);
  });

  it("isn't implied by the view-only team-lead marker", async () => {
    expect((await getCrmAccess("u1", perms([CRM_TEAM_LEAD_PAGE]))).canNoteAnyLead).toBe(false);
  });

  it("lets the holder note any lead, whoever owns it", () => {
    expect(canAddNote(head, { assignedToId: "u2" }, "u1")).toBe(true);
    expect(canAddNote(head, { assignedToId: null }, "u1")).toBe(true);
  });

  it("keeps everyone else to the leads they may edit", () => {
    const bde = access({ isBde: true });
    expect(canAddNote(bde, { assignedToId: "u1" }, "u1")).toBe(true);
    expect(canAddNote(bde, { assignedToId: "u2" }, "u1")).toBe(false);
    expect(canAddNote(access({}), { assignedToId: "u2" }, "u1")).toBe(false);
  });

  it("lets the holder edit their own note but never a consultant's on the same lead", () => {
    const lead = { assignedToId: "u2" };
    expect(canEditNote(head, { authorId: "u1" }, lead, "u1")).toBe(true);
    expect(canEditNote(head, { authorId: "u2" }, lead, "u1")).toBe(false);
    expect(canEditNote(head, { authorId: null }, lead, "u1")).toBe(false);
  });

  it("leaves the lead's owner able to edit any note on it", () => {
    const bde = access({ isBde: true });
    expect(canEditNote(bde, { authorId: "u2" }, { assignedToId: "u1" }, "u1")).toBe(true);
  });
});

describe("ROLE_PERMISSIONS (markers grantable in /roles)", () => {
  it("lists every CRM capability marker by its real href", () => {
    const hrefs = ROLE_PERMISSIONS.map((p) => p.href);
    for (const marker of [
      CRM_ASSIGN_PAGE,
      CRM_HISTORY_PAGE,
      CRM_TEAM_LEAD_PAGE,
      CRM_REFERRAL_LEADS_PAGE,
      CRM_ENROLLED_TASKS_PAGE,
      CRM_NOTES_ALL_PAGE,
      CRM_LEADS_ONLY_PAGE,
    ]) {
      expect(hrefs).toContain(marker);
      // The roles API keeps only GRANTABLE_HREFS — a missing marker is stripped on save.
      expect(GRANTABLE_HREFS).toContain(marker);
    }
  });
});

describe("own tasks only (an enrolled-lead task-taker who isn't a consultant)", () => {
  function nextLeadPulseRole(role: "l2" | "supervisor") {
    vi.mocked(getLeadPulseAccess).mockResolvedValueOnce({
      role,
      displayName: "Test",
      canSupervise: role === "supervisor",
      canSubmitEntries: role !== "supervisor",
      desfinAdmin: false,
    });
  }

  it("scopes a plain task-taker to their own tasks", async () => {
    const a = await getCrmAccess("u1", perms(["/crm/leads", CRM_ENROLLED_TASKS_PAGE]));
    expect(a.ownTasksOnly).toBe(true);
    expect(visibleTasksWhere(a, "u1")).toEqual({ assignedToId: "u1" });
  });

  it("leaves everyone else seeing every task", async () => {
    expect(visibleTasksWhere(await getCrmAccess("u1", perms(["/crm/leads"])), "u1")).toEqual({});
    expect((await getCrmAccess("u1", perms([CRM_ENROLLED_TASKS_PAGE], true))).ownTasksOnly).toBe(false);
    expect((await getCrmAccess("u1", perms(["/crm/settings", CRM_ENROLLED_TASKS_PAGE]))).ownTasksOnly).toBe(false);
    expect(
      (await getCrmAccess("u1", perms(["/crm/leads", CRM_TEAM_LEAD_PAGE, CRM_ENROLLED_TASKS_PAGE]))).ownTasksOnly,
    ).toBe(false);
    nextLeadPulseRole("l2");
    expect((await getCrmAccess("u1", perms(["/crm/leads", CRM_ENROLLED_TASKS_PAGE]))).ownTasksOnly).toBe(false);
    nextLeadPulseRole("supervisor");
    expect((await getCrmAccess("u1", perms(["/crm/leads", CRM_ENROLLED_TASKS_PAGE]))).ownTasksOnly).toBe(false);
  });
});
