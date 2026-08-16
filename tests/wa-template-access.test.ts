import { describe, it, expect } from "vitest";
import { allowedTemplateKeys, filterTemplatesFor, templateKey } from "@/lib/wa/template-access";
import { canViewAllConversations, canViewConversation, conversationVisibilityWhere } from "@/lib/wa/access";
import { countTemplateVariables, renderTemplatePreview } from "@/lib/wa/cloud-provider";
import type { CrmAccess } from "@/lib/crm-rbac";

function access(over: Partial<CrmAccess> = {}): CrmAccess {
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
    ...over,
  };
}

const TEMPLATES = [
  { name: "welcome", language: "en_US" },
  { name: "followup", language: "en_US" },
  { name: "offer", language: "en_US" },
];

describe("template grants", () => {
  it("keys a template by name and language, since the same name exists per language", () => {
    expect(templateKey("welcome", "en_US")).toBe("welcome:en_US");
  });

  it("grants to a named person", () => {
    const grants = [{ templateKey: "welcome:en_US", userId: "u1", leadPulseRole: null }];
    expect([...allowedTemplateKeys(grants, { userId: "u1", leadPulseRole: "l2" })]).toEqual(["welcome:en_US"]);
  });

  it("grants to a whole role tier — one row instead of twenty that drift", () => {
    const grants = [{ templateKey: "offer:en_US", userId: null, leadPulseRole: "l2" }];
    expect([...allowedTemplateKeys(grants, { userId: "u9", leadPulseRole: "l2" })]).toEqual(["offer:en_US"]);
  });

  it("does not leak a tier grant to a different tier", () => {
    const grants = [{ templateKey: "offer:en_US", userId: null, leadPulseRole: "supervisor" }];
    expect(allowedTemplateKeys(grants, { userId: "u9", leadPulseRole: "l2" }).size).toBe(0);
  });

  it("does not leak a personal grant to anyone else", () => {
    const grants = [{ templateKey: "offer:en_US", userId: "u2", leadPulseRole: null }];
    expect(allowedTemplateKeys(grants, { userId: "u1", leadPulseRole: "l2" }).size).toBe(0);
  });
});

describe("filterTemplatesFor", () => {
  // The whole point: a consultant must not be shown the entire catalogue.
  it("DENIES by default — no grants means no templates", () => {
    expect(filterTemplatesFor(TEMPLATES, access({ isBde: true }), [], "l2")).toEqual([]);
  });

  it("shows only what was granted", () => {
    const grants = [
      { templateKey: "welcome:en_US", userId: "u1", leadPulseRole: null },
      { templateKey: "offer:en_US", userId: null, leadPulseRole: "l2" },
    ];
    const out = filterTemplatesFor(TEMPLATES, access({ isBde: true }), grants, "l2");
    expect(out.map((t) => t.name).sort()).toEqual(["offer", "welcome"]);
  });

  // Admins assign the grants; needing a grant to see a template in order to
  // grant it would be circular.
  it("gives admins everything regardless of grants", () => {
    expect(filterTemplatesFor(TEMPLATES, access({ isAdmin: true }), [], null)).toHaveLength(3);
  });

  it("gives a user with no role tier only their personal grants", () => {
    const grants = [{ templateKey: "offer:en_US", userId: null, leadPulseRole: "l2" }];
    expect(filterTemplatesFor(TEMPLATES, access({ isBde: true }), grants, null)).toEqual([]);
  });
});

describe("conversation visibility", () => {
  it("lets oversight roles see the whole desk", () => {
    for (const flag of ["isAdmin", "isSupervisor", "isCrmTeamLead", "canManageCrm"] as const) {
      expect(canViewAllConversations(access({ [flag]: true }))).toBe(true);
      expect(conversationVisibilityWhere(access({ [flag]: true }), "u1")).toEqual({});
    }
  });

  it("restricts a consultant to their own candidates", () => {
    expect(canViewAllConversations(access({ isBde: true }))).toBe(false);
    expect(conversationVisibilityWhere(access({ isBde: true }), "u1")).toEqual({
      OR: [{ lead: { assignedToId: "u1" } }, { assignedToId: "u1" }],
    });
  });

  it("counts a thread as theirs when either the lead or the thread is theirs", () => {
    const bde = access({ isBde: true });
    expect(canViewConversation(bde, { leadAssignedToId: "u1", conversationAssignedToId: null }, "u1")).toBe(true);
    // A stranger's first message has no lead but can be handed to someone.
    expect(canViewConversation(bde, { leadAssignedToId: null, conversationAssignedToId: "u1" }, "u1")).toBe(true);
  });

  it("keeps a consultant out of someone else's conversation", () => {
    const bde = access({ isBde: true });
    expect(canViewConversation(bde, { leadAssignedToId: "u2", conversationAssignedToId: "u2" }, "u1")).toBe(false);
    // Unowned by anyone is still not theirs to read.
    expect(canViewConversation(bde, { leadAssignedToId: null, conversationAssignedToId: null }, "u1")).toBe(false);
  });
});

describe("template variables", () => {
  it("counts distinct placeholders, not occurrences", () => {
    expect(countTemplateVariables("Hi {{1}}, your {{2}} is ready, {{1}}.")).toBe(2);
  });
  it("is zero for a template with no variables", () => {
    expect(countTemplateVariables("Hello there")).toBe(0);
    expect(countTemplateVariables(null)).toBe(0);
  });
  it("tolerates whitespace inside the braces", () => {
    expect(countTemplateVariables("Hi {{ 1 }}")).toBe(1);
  });

  it("fills a preview and leaves unfilled placeholders visible", () => {
    // Visible-but-unfilled reads as obviously incomplete; blanking them would
    // look like a finished message with a hole in it.
    expect(renderTemplatePreview("Hi {{1}}, re {{2}}", { "1": "Priya" })).toBe("Hi Priya, re {{2}}");
  });
});
