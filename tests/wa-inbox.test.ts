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
    for (const f of WA_INBOX_FILTERS) expect(normalizeInboxFilter(f, { isBde: true })).toBe(f);
  });

  it("lands a BDE on their own threads", () => {
    expect(normalizeInboxFilter(null, { isBde: true })).toBe("mine");
    expect(normalizeInboxFilter("../../etc/passwd", { isBde: true })).toBe("mine");
  });

  // An admin or supervisor owns no conversations, so defaulting them to "mine"
  // would open the inbox on an empty list.
  it("lands a non-BDE on the work that needs answering", () => {
    expect(normalizeInboxFilter(null, { isBde: false })).toBe("needs_reply");
    expect(normalizeInboxFilter("", { isBde: false })).toBe("needs_reply");
  });

  it("an explicit choice always beats the role default", () => {
    expect(normalizeInboxFilter("all", { isBde: true })).toBe("all");
  });
});

describe("buildInboxWhere", () => {
  const scope = { userId: "u1", isBde: true };
  const OPEN = { status: { not: "closed" } };

  it("scopes 'mine' to the caller", () => {
    expect(buildInboxWhere("mine", scope)).toEqual({ AND: [OPEN, { assignedToId: "u1" }] });
  });
  it("finds the unassigned queue", () => {
    expect(buildInboxWhere("unassigned", scope)).toEqual({ AND: [OPEN, { assignedToId: null }] });
  });
  it("reads the maintained flag for needs-reply, not a column comparison", () => {
    expect(buildInboxWhere("needs_reply", scope)).toEqual({ AND: [OPEN, { awaitingReply: true }] });
  });
  it("filters unread on the counter", () => {
    expect(buildInboxWhere("unread", scope)).toEqual({ AND: [OPEN, { unreadCount: { gt: 0 } }] });
  });

  // Closing is the only way to get a thread out of the way, so a working filter
  // that ignores `status` makes the button do nothing.
  it("hides closed threads from EVERY working filter", () => {
    for (const f of ["mine", "unassigned", "unread", "needs_reply", "all"] as const) {
      const and = buildInboxWhere(f, scope).AND as Record<string, unknown>[];
      expect(and).toContainEqual(OPEN);
    }
  });

  it("shows only closed threads in the closed view, so a mistake is recoverable", () => {
    expect(buildInboxWhere("closed", scope)).toEqual({ AND: [{ status: "closed" }] });
  });

  it("searches number, name and email together", () => {
    const where = buildInboxWhere("all", scope, "priya");
    const and = where.AND as Record<string, unknown>[];
    const or = and[and.length - 1].OR as Record<string, unknown>[];
    expect(or).toHaveLength(3);
    expect(or[0]).toEqual({ phoneE164: { contains: "priya", mode: "insensitive" } });
  });
  it("ignores a whitespace-only search rather than matching everything", () => {
    expect(buildInboxWhere("all", scope, "   ")).toEqual({ AND: [OPEN] });
  });
  it("combines a filter with a search", () => {
    expect((buildInboxWhere("needs_reply", scope, "98765").AND as unknown[])).toHaveLength(3);
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
  /** An unowned thread: no lead, nobody assigned. */
  const unowned = { leadAssignedToId: null, conversationAssignedToId: null, hasLead: false };

  it("lets anyone with the assign capability hand a thread over", () => {
    const conv = { leadAssignedToId: null, conversationAssignedToId: "u2", hasLead: false };
    expect(canAssignConversation(access({ canAssign: true }), conv, "u3", "u1")).toBe(true);
  });

  it("lets a BDE claim an unowned thread for themselves", () => {
    expect(canAssignConversation(access({ isBde: true }), unowned, "u1", "u1")).toBe(true);
  });

  it("does NOT let a BDE take a thread that already has an owner", () => {
    const conv = { leadAssignedToId: null, conversationAssignedToId: "u2", hasLead: false };
    expect(canAssignConversation(access({ isBde: true }), conv, "u1", "u1")).toBe(false);
  });

  it("does NOT let a BDE push work onto someone else", () => {
    expect(canAssignConversation(access({ isBde: true }), unowned, "u2", "u1")).toBe(false);
  });

  // The conversation's own assignedToId is copied from the lead only when the
  // thread is created and never backfilled, so "conversation unassigned" does
  // not mean "unowned" — the lead has to be checked too, or a BDE could quietly
  // pull a colleague's candidate onto themselves.
  it("does NOT let a BDE claim a thread whose LEAD belongs to another consultant", () => {
    const conv = { leadAssignedToId: "u2", conversationAssignedToId: null, hasLead: true };
    expect(canAssignConversation(access({ isBde: true }), conv, "u1", "u1")).toBe(false);
  });

  it("still lets a BDE claim a thread whose lead is theirs but unassigned on the conversation", () => {
    const conv = { leadAssignedToId: "u1", conversationAssignedToId: null, hasLead: true };
    expect(canAssignConversation(access({ isBde: true }), conv, "u1", "u1")).toBe(true);
  });

  it("still lets a BDE claim a lead-linked thread nobody owns", () => {
    const conv = { leadAssignedToId: null, conversationAssignedToId: null, hasLead: true };
    expect(canAssignConversation(access({ isBde: true }), conv, "u1", "u1")).toBe(true);
  });
});
