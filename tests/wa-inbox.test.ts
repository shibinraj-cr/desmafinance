import { describe, it, expect } from "vitest";
import {
  buildInboxWhere,
  isAwaitingReply,
  normalizeInboxFilter,
  WA_INBOX_FILTERS,
} from "@/lib/wa/inbox";
import { canActOnConversation, canAssignConversation } from "@/lib/wa/access";
import type { CrmAccess } from "@/lib/crm-rbac";

/** Minimal CrmAccess; each test overrides only the flags it cares about. */
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

describe("normalizeInboxFilter", () => {
  it("accepts every declared filter", () => {
    for (const f of WA_INBOX_FILTERS) expect(normalizeInboxFilter(f)).toBe(f);
  });
  it("falls back to 'mine' on junk or absence", () => {
    expect(normalizeInboxFilter(null)).toBe("mine");
    expect(normalizeInboxFilter("")).toBe("mine");
    expect(normalizeInboxFilter("../../etc/passwd")).toBe("mine");
  });
});

describe("buildInboxWhere", () => {
  const scope = { userId: "u1", isBde: true };

  it("scopes 'mine' to the caller", () => {
    expect(buildInboxWhere("mine", scope)).toEqual({ AND: [{ assignedToId: "u1" }] });
  });
  it("finds the unassigned queue", () => {
    expect(buildInboxWhere("unassigned", scope)).toEqual({ AND: [{ assignedToId: null }] });
  });
  it("reads the maintained flag for needs-reply, not a column comparison", () => {
    expect(buildInboxWhere("needs_reply", scope)).toEqual({ AND: [{ awaitingReply: true }] });
  });
  it("filters unread on the counter", () => {
    expect(buildInboxWhere("unread", scope)).toEqual({ AND: [{ unreadCount: { gt: 0 } }] });
  });
  it("places no constraint on 'all'", () => {
    expect(buildInboxWhere("all", scope)).toEqual({});
  });

  it("searches number, name and email together", () => {
    const where = buildInboxWhere("all", scope, "priya");
    expect(where.AND).toHaveLength(1);
    const or = (where.AND as Record<string, unknown>[])[0].OR as Record<string, unknown>[];
    expect(or).toHaveLength(3);
    expect(or[0]).toEqual({ phoneE164: { contains: "priya", mode: "insensitive" } });
  });
  it("ignores a whitespace-only search rather than matching everything", () => {
    expect(buildInboxWhere("all", scope, "   ")).toEqual({});
  });
  it("combines a filter with a search", () => {
    const where = buildInboxWhere("needs_reply", scope, "98765");
    expect(where.AND).toHaveLength(2);
  });
});

describe("isAwaitingReply", () => {
  const t = (s: string) => new Date(s);

  it("is false when the candidate has never written", () => {
    expect(isAwaitingReply({ lastInboundAt: null, lastMessageAt: t("2026-08-13T09:00:00Z") })).toBe(false);
  });
  it("is true when an inbound message is the newest thing on the thread", () => {
    expect(
      isAwaitingReply({ lastInboundAt: t("2026-08-13T09:00:00Z"), lastMessageAt: t("2026-08-13T09:00:00Z") }),
    ).toBe(true);
  });
  it("is false once we have replied — an outbound send bumps lastMessageAt alone", () => {
    expect(
      isAwaitingReply({ lastInboundAt: t("2026-08-13T09:00:00Z"), lastMessageAt: t("2026-08-13T09:05:00Z") }),
    ).toBe(false);
  });
  it("is true for an inbound-only thread with no lastMessageAt at all", () => {
    expect(isAwaitingReply({ lastInboundAt: t("2026-08-13T09:00:00Z"), lastMessageAt: null })).toBe(true);
  });
});

describe("canActOnConversation", () => {
  const linkedToOther = { leadAssignedToId: "u2", conversationAssignedToId: null, hasLead: true };
  const linkedToMe = { leadAssignedToId: "u1", conversationAssignedToId: null, hasLead: true };

  it("defers to the lead's own edit rule when the thread is linked", () => {
    expect(canActOnConversation(access({ isBde: true }), linkedToMe, "u1")).toBe(true);
    expect(canActOnConversation(access({ isBde: true }), linkedToOther, "u1")).toBe(false);
  });

  it("lets admins and supervisors act on any linked thread", () => {
    expect(canActOnConversation(access({ isAdmin: true }), linkedToOther, "u1")).toBe(true);
    expect(canActOnConversation(access({ isSupervisor: true }), linkedToOther, "u1")).toBe(true);
  });

  it("gives an UNLINKED assigned thread to its assignee", () => {
    const conv = { leadAssignedToId: null, conversationAssignedToId: "u1", hasLead: false };
    expect(canActOnConversation(access({ isBde: true }), conv, "u1")).toBe(true);
  });

  it("keeps another consultant out of an unlinked thread that is already owned", () => {
    const conv = { leadAssignedToId: null, conversationAssignedToId: "u2", hasLead: false };
    expect(canActOnConversation(access({ isBde: true }), conv, "u1")).toBe(false);
  });

  // A stranger's first message has no lead and no owner. Locking it to admins
  // would leave exactly the messages the inbox exists to catch sitting unanswered.
  it("lets any BDE pick up an unlinked, unassigned thread", () => {
    const conv = { leadAssignedToId: null, conversationAssignedToId: null, hasLead: false };
    expect(canActOnConversation(access({ isBde: true }), conv, "u1")).toBe(true);
  });

  it("does not let a non-BDE CRM viewer act on that same thread", () => {
    const conv = { leadAssignedToId: null, conversationAssignedToId: null, hasLead: false };
    expect(canActOnConversation(access({ isCrmTeamLead: true }), conv, "u1")).toBe(false);
  });
});

describe("canAssignConversation", () => {
  it("lets anyone with the assign capability hand a thread over", () => {
    expect(canAssignConversation(access({ canAssign: true }), { conversationAssignedToId: "u2" }, "u3", "u1")).toBe(true);
  });

  it("lets a BDE claim an unassigned thread for themselves", () => {
    expect(canAssignConversation(access({ isBde: true }), { conversationAssignedToId: null }, "u1", "u1")).toBe(true);
  });

  it("does NOT let a BDE take a thread that already has an owner", () => {
    expect(canAssignConversation(access({ isBde: true }), { conversationAssignedToId: "u2" }, "u1", "u1")).toBe(false);
  });

  it("does NOT let a BDE push work onto someone else", () => {
    expect(canAssignConversation(access({ isBde: true }), { conversationAssignedToId: null }, "u2", "u1")).toBe(false);
  });
});
