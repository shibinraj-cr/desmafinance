/**
 * GET /api/crm/leads/[id] as the mobile app reads it: the lead, plus where
 * Finance is with its enrollment and whether the caller may backdate one.
 * Prisma and the enrollment loader are mocked; crm-rbac runs for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ lead: { findUnique: vi.fn() } }));
const lp = vi.hoisted(() => ({ canSubmitEntries: true, role: "l2" as string | null }));
const user = vi.hoisted(() => ({ id: "bde1", isAdmin: false }));
const enrollment = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({
    userId: user.id,
    perms: { isAdmin: user.isAdmin, canApprove: false, needsApproval: false, draftFirst: false, pages: ["/crm/leads"], roleName: "Test" },
  })),
}));
vi.mock("@/lib/lead-pulse-rbac", () => ({
  getLeadPulseAccess: vi.fn(async () => ({ ...lp, displayName: null })),
}));
vi.mock("@/lib/crm-leads", async (orig) => ({
  ...(await orig<typeof import("@/lib/crm-leads")>()),
  serializeLead: (l: { id: string }) => ({ id: l.id }),
}));
vi.mock("@/lib/crm-enrollment", () => ({ leadEnrollment: enrollment }));

import { GET } from "@/app/api/crm/leads/[id]/route";

const params = { id: "lead1" };
const req = () => new Request("http://local/api/crm/leads/lead1");
const leadIn = (code: string) => ({ id: "lead1", assignedToId: "bde1", status: { id: "s", code, label: code, kind: "open", color: null } });

const FIELDS = {
  billingName: "Test Candidate",
  billingCountry: "India",
  billingState: "Kerala",
  billingAddress: null,
  billingPin: null,
  totalAmount: 100000,
  firstAmount: 20000,
  paidOn: "2026-11-18",
  paymentMode: "Axis Bank",
  utr: "AXIS0001",
  payerRelation: "candidate",
  payerName: null,
  plan: [{ date: "2026-12-18", amount: 80000 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  user.id = "bde1";
  user.isAdmin = false;
  lp.canSubmitEntries = true;
  lp.role = "l2";
});

describe("GET /api/crm/leads/[id]", () => {
  it("returns the enrollment of an enrolled lead, trimmed to what the app shows", async () => {
    db.lead.findUnique.mockResolvedValue(leadIn("enrolled"));
    enrollment.mockResolvedValue({
      id: "e1",
      leadId: "lead1",
      partyId: "p1",
      status: "sent_back",
      exception: null,
      exceptionNote: null,
      financeNote: "UTR not on the statement",
      fields: FIELDS,
      submitted: FIELDS,
      verifiedAt: null,
      verifiedByName: null,
      transactionId: null,
      invoice: null,
    });
    const body = await (await GET(req(), { params })).json();
    expect(enrollment).toHaveBeenCalledWith("lead1");
    expect(body.lead).toEqual({ id: "lead1" });
    expect(body.canEdit).toBe(true);
    expect(body.canBackdate).toBe(false);
    expect(body.enrollment).toEqual({
      status: "sent_back",
      exception: null,
      exceptionNote: null,
      financeNote: "UTR not on the statement",
      fields: FIELDS,
      verifiedAt: null,
      invoiceNumber: null,
    });
  });

  it("names the invoice of a verified enrollment", async () => {
    db.lead.findUnique.mockResolvedValue(leadIn("enrolled"));
    enrollment.mockResolvedValue({ status: "verified", exception: null, exceptionNote: null, financeNote: null, fields: FIELDS, verifiedAt: "2026-11-19T06:00:00.000Z", invoice: { id: "i1", number: "D/DIPL/26-27/0001" } });
    const body = await (await GET(req(), { params })).json();
    expect(body.enrollment).toMatchObject({ status: "verified", invoiceNumber: "D/DIPL/26-27/0001", verifiedAt: "2026-11-19T06:00:00.000Z" });
  });

  it("doesn't look for an enrollment on a lead that isn't enrolled", async () => {
    db.lead.findUnique.mockResolvedValue(leadIn("pipeline"));
    const body = await (await GET(req(), { params })).json();
    expect(enrollment).not.toHaveBeenCalled();
    expect(body.enrollment).toBeNull();
  });

  it("lets whoever may un-enroll backdate, as on the web", async () => {
    user.isAdmin = true;
    db.lead.findUnique.mockResolvedValue(leadIn("pipeline"));
    const body = await (await GET(req(), { params })).json();
    expect(body.canBackdate).toBe(true);
  });
});
