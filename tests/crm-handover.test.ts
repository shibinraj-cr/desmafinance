import { describe, it, expect } from "vitest";
import {
  HANDOVER_CHANNELS,
  canRejectHandover,
  handoverAccess,
  handoverGroupLabel,
  handoverListWhere,
  linkStatusFor,
  parseHandoverPaste,
  planHandoverRows,
} from "@/lib/crm-handover";

describe("channels", () => {
  it("map to the existing YouTube / Insta / Candidate Referral sources and the four new ones", () => {
    expect(Object.fromEntries(HANDOVER_CHANNELS.map((c) => [c.code, c.sourceCode]))).toEqual({
      youtube: "youtube",
      instagram: "insta",
      whatsapp_outside: "whatsapp_personal",
      phone: "phone_direct",
      walk_in: "walk_in",
      referral: "candidate_referral",
      other: "other",
    });
  });

  it("group in the report as 'Handover – <channel>'", () => {
    expect(handoverGroupLabel("walk_in")).toBe("Handover – Walk-in");
    expect(handoverGroupLabel("youtube")).toBe("Handover – YouTube");
    expect(handoverGroupLabel("instagram")).toBe("Handover – Instagram");
  });
});

describe("handoverAccess", () => {
  const base = { isAdmin: false, roleName: null, lpRole: null, canManageCrm: false, isCrmTeamLead: false, isBde: false };

  it("the Marketing Admin role and active LP supervisors manage handovers", () => {
    expect(handoverAccess({ ...base, roleName: "Marketing Admin" })).toEqual({ canManage: true, viewScope: "all" });
    expect(handoverAccess({ ...base, lpRole: { role: "supervisor", active: true } }).canManage).toBe(true);
    expect(handoverAccess({ ...base, isAdmin: true }).canManage).toBe(true);
  });

  it("an inactive supervisor does not", () => {
    expect(handoverAccess({ ...base, lpRole: { role: "supervisor", active: false } })).toEqual({
      canManage: false,
      viewScope: null,
    });
  });

  it("CRM managers read every BDE's; a BDE reads their own; others nothing", () => {
    expect(handoverAccess({ ...base, canManageCrm: true })).toEqual({ canManage: false, viewScope: "all" });
    expect(handoverAccess({ ...base, isCrmTeamLead: true, isBde: true }).viewScope).toBe("all");
    expect(handoverAccess({ ...base, isBde: true })).toEqual({ canManage: false, viewScope: "own" });
    expect(handoverAccess(base).viewScope).toBeNull();
  });

  it("only the assigned BDE or a manager rejects", () => {
    const bde = { canManage: false, viewScope: "own" as const };
    expect(canRejectHandover(bde, "u1", { assignedBdeId: "u1" })).toBe(true);
    expect(canRejectHandover(bde, "u2", { assignedBdeId: "u1" })).toBe(false);
    expect(canRejectHandover({ canManage: true, viewScope: "all" }, "ma", { assignedBdeId: "u1" })).toBe(true);
  });
});

describe("parseHandoverPaste", () => {
  it("reads name/phone pairs separated by a tab or a comma, in either order", () => {
    const { rows, errors } = parseHandoverPaste("Asha\t9876543210\n9123456780, Binu\n\n  Chitra ; +91 98765 43211 ");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { leadName: "Asha", phone: "9876543210" },
      { leadName: "Binu", phone: "9123456780" },
      { leadName: "Chitra", phone: "+91 98765 43211" },
    ]);
  });

  it("accepts a bare number", () => {
    expect(parseHandoverPaste("094-1234-5678").rows).toEqual([{ leadName: null, phone: "094-1234-5678" }]);
  });

  it("reports lines it cannot use, with their line number", () => {
    const { rows, errors } = parseHandoverPaste("Name, Phone\nAsha, 9876543210\nBinu, 12345");
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([
      { line: 1, text: "Name, Phone", reason: "No phone number" },
      { line: 3, text: "Binu, 12345", reason: "No phone number" },
    ]);
  });
});

describe("planHandoverRows (H1)", () => {
  const leadByPhone = new Map([["+919412345678", "lead-1"]]);

  it("matches an existing lead whatever way the number is written", () => {
    const plans = planHandoverRows(
      [{ phone: "09412345678" }],
      leadByPhone,
      new Set(),
    );
    expect(plans).toEqual([{ kind: "duplicate", phoneE164: "+919412345678", leadId: "lead-1" }]);
    expect(planHandoverRows([{ phone: "+91 94123 45678" }], leadByPhone, new Set())[0]).toMatchObject({
      kind: "duplicate",
    });
    expect(planHandoverRows([{ phone: "94123-45678" }], leadByPhone, new Set())[0]).toMatchObject({
      kind: "duplicate",
    });
  });

  it("a new number is pending", () => {
    expect(planHandoverRows([{ phone: "9876543210" }], leadByPhone, new Set())).toEqual([
      { kind: "pending", phoneE164: "+919876543210" },
    ]);
  });

  it("refuses bad numbers, repeats in the same list, and numbers already handed over", () => {
    const plans = planHandoverRows(
      [{ phone: "123" }, { phone: "9876543210" }, { phone: "09876543210" }, { phone: "9000000001" }],
      leadByPhone,
      new Set(["+919000000001"]),
    );
    expect(plans.map((p) => (p.kind === "error" ? p.reason : p.kind))).toEqual([
      "Not a valid phone number",
      "pending",
      "Repeated in this list",
      "Already handed over and still open",
    ]);
  });
});

describe("linkStatusFor", () => {
  it("a lead created after the handover is the BDE's work; one from before is a duplicate", () => {
    const h = new Date("2026-11-09T05:00:00Z");
    expect(linkStatusFor(new Date("2026-11-09T06:00:00Z"), h)).toBe("created");
    expect(linkStatusFor(new Date("2026-11-08T06:00:00Z"), h)).toBe("duplicate");
  });
});

describe("handoverListWhere", () => {
  const manager = { canManage: true, viewScope: "all" as const };
  const bde = { canManage: false, viewScope: "own" as const };

  it("locks a BDE to their own handovers, ignoring a bde filter", () => {
    expect(handoverListWhere(bde, "u1", { bdeIds: ["u2"] })).toEqual({ AND: [{ assignedBdeId: "u1" }] });
  });

  it("lets a manager filter by BDE, status and channel", () => {
    expect(handoverListWhere(manager, "ma", { bdeIds: ["u2"], statuses: ["overdue"], channels: ["walk_in"] })).toEqual({
      AND: [
        { assignedBdeId: { in: ["u2"] } },
        { status: { in: ["overdue"] } },
        { channel: { in: ["walk_in"] } },
      ],
    });
  });

  it("a day plus 'still open' is an OR", () => {
    expect(handoverListWhere(bde, "u1", { date: "2026-11-09", withOpen: true })).toEqual({
      AND: [
        { assignedBdeId: "u1" },
        {
          OR: [
            { handoverDate: new Date("2026-11-09T00:00:00.000Z") },
            { status: { in: ["pending", "overdue"] } },
          ],
        },
      ],
    });
  });

  it("no view scope, no query", () => {
    expect(handoverListWhere({ canManage: false, viewScope: null }, "x", {})).toBeNull();
  });
});
