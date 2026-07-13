/**
 * Route-level tests for the finance API surface.
 *
 * Two guarantees are pinned here:
 *   1. AUTHORIZATION — every finance route rejects a caller who lacks the
 *      relevant finance page (401 when unauthenticated, 403 when the page isn't
 *      granted), and the data query is never reached.
 *   2. WRITE VALIDATION — create derives `month` from `date` server-side, and
 *      the rejected-resubmit + draft-edit paths run the same strict validation
 *      as a normal create (zero amount, unknown category, bad enum, missing
 *      EXP/DOM are all refused).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Permissions } from "@/lib/rbac";

vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn() },
    collectionPlan: { findMany: vi.fn() },
    pendingApproval: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/approval", () => ({
  submitCreate: vi.fn(),
  submitUpdate: vi.fn(),
  submitDelete: vi.fn(),
  updateDraft: vi.fn(),
  discardDraft: vi.fn(),
  submitDraftToPending: vi.fn(),
}));

vi.mock("@/lib/master-data", () => ({
  verifyCategorySubItem: vi.fn(async () => null),
}));

vi.mock("@/lib/tx-counterparty", () => ({
  validateCounterparty: vi.fn(async () => null),
}));

vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn(async () => {}) }));

import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { submitCreate, updateDraft } from "@/lib/approval";
import { verifyCategorySubItem } from "@/lib/master-data";

import { GET as txGet, POST as txPost } from "@/app/api/finance/transactions/route";
import { GET as exportGet } from "@/app/api/finance/export/route";
import { POST as resubmitPost } from "@/app/api/finance/approvals/[id]/resubmit/route";
import { PATCH as draftPatch } from "@/app/api/finance/drafts/[id]/route";

const getPerms = getCurrentUserAndPermissions as unknown as ReturnType<typeof vi.fn>;
const txFindMany = prisma.transaction.findMany as unknown as ReturnType<typeof vi.fn>;
const pendingFindUnique = prisma.pendingApproval.findUnique as unknown as ReturnType<typeof vi.fn>;
const pendingUpdate = prisma.pendingApproval.update as unknown as ReturnType<typeof vi.fn>;
const submitCreateMock = submitCreate as unknown as ReturnType<typeof vi.fn>;
const updateDraftMock = updateDraft as unknown as ReturnType<typeof vi.fn>;
const verifyCat = verifyCategorySubItem as unknown as ReturnType<typeof vi.fn>;

function perms(pages: string[], extra: Partial<Permissions> = {}): Permissions {
  return {
    isAdmin: false,
    canApprove: false,
    needsApproval: true,
    draftFirst: false,
    pages,
    roleName: "Test",
    ...extra,
  };
}

/** Build a JSON POST/PATCH Request the route handlers can read. */
function jsonReq(url: string, body: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validProposed(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-07-15",
    type: "Revenue",
    category: "Sales - Nursing Registrations",
    subItem: "AHPRA OBA Pathway (Sales)",
    description: null,
    paymentMode: "HDFC Bank",
    amount: 1000,
    flow: "Inflow",
    partyId: "party1",
    employeeId: null,
    expDom: "DOM",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyCat.mockResolvedValue(null);
});

describe("authorization — GET /api/finance/transactions", () => {
  it("returns 401 and never queries when there is no session", async () => {
    getPerms.mockResolvedValue({ perms: null, userId: null });
    const res = await txGet(new Request("http://t/api/finance/transactions") as never);
    expect(res.status).toBe(401);
    expect(txFindMany).not.toHaveBeenCalled();
  });

  it("returns 403 and never queries when the caller lacks the Daily Tracker page", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/overview"]), userId: "u1" });
    const res = await txGet(new Request("http://t/api/finance/transactions") as never);
    expect(res.status).toBe(403);
    expect(txFindMany).not.toHaveBeenCalled();
  });

  it("serves data to a caller who has the Daily Tracker page", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/daily-tracker"]), userId: "u1" });
    txFindMany.mockResolvedValue([]);
    const res = await txGet(new Request("http://t/api/finance/transactions") as never);
    expect(res.status).toBe(200);
    expect(txFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("authorization — POST /api/finance/transactions", () => {
  it("returns 403 without the Daily Tracker page and never writes", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/overview"]), userId: "u1" });
    const res = await txPost(jsonReq("http://t/api/finance/transactions", validProposed()) as never);
    expect(res.status).toBe(403);
    expect(submitCreateMock).not.toHaveBeenCalled();
  });
});

describe("authorization — GET /api/finance/export", () => {
  it("returns 403 without the Overview page", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/daily-tracker"]), userId: "u1" });
    const res = await exportGet(new Request("http://t/api/finance/export") as never);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/finance/transactions — derives month from date", () => {
  it("stores the month derived from the date, ignoring a mismatched client month", async () => {
    getPerms.mockResolvedValue({
      perms: perms(["/finance/daily-tracker"], { canApprove: true, needsApproval: false }),
      userId: "u1",
    });
    submitCreateMock.mockResolvedValue({
      applied: true,
      transaction: { id: "tx1", amount: { toString: () => "1000" } },
    });

    // Client lies about the month (Jan-27); the server must derive Jul-26.
    const res = await txPost(
      jsonReq("http://t/api/finance/transactions", validProposed({ month: "Jan-27" })) as never,
    );

    expect(res.status).toBe(200);
    expect(submitCreateMock).toHaveBeenCalledTimes(1);
    expect(submitCreateMock.mock.calls[0][0].data.month).toBe("Jul-26");
  });
});

describe("POST /api/finance/approvals/[id]/resubmit — strict validation", () => {
  function asRejectedOwnedBy(userId: string) {
    pendingFindUnique.mockResolvedValue({
      id: "p1",
      submittedById: userId,
      status: "rejected",
      kind: "create",
      reviewNote: null,
      reviewedById: null,
    });
  }

  it("returns 401 when unauthenticated", async () => {
    getPerms.mockResolvedValue({ perms: null, userId: null });
    const res = await resubmitPost(
      jsonReq("http://t/api/finance/approvals/p1/resubmit", { proposed: validProposed() }) as never,
      { params: { id: "p1" } },
    );
    expect(res.status).toBe(401);
    expect(pendingFindUnique).not.toHaveBeenCalled();
  });

  it("rejects a zero-amount resubmit and never updates the pending row", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/approvals"]), userId: "u1" });
    asRejectedOwnedBy("u1");
    const res = await resubmitPost(
      jsonReq("http://t/api/finance/approvals/p1/resubmit", {
        proposed: validProposed({ amount: 0 }),
      }) as never,
      { params: { id: "p1" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_amount" });
    expect(pendingUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown category", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/approvals"]), userId: "u1" });
    asRejectedOwnedBy("u1");
    verifyCat.mockResolvedValue("category_not_found");
    const res = await resubmitPost(
      jsonReq("http://t/api/finance/approvals/p1/resubmit", {
        proposed: validProposed({ category: "Ghost" }),
      }) as never,
      { params: { id: "p1" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "category_not_found" });
    expect(pendingUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid payment mode", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/approvals"]), userId: "u1" });
    asRejectedOwnedBy("u1");
    const res = await resubmitPost(
      jsonReq("http://t/api/finance/approvals/p1/resubmit", {
        proposed: validProposed({ paymentMode: "Bitcoin" }),
      }) as never,
      { params: { id: "p1" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_payment_mode" });
  });

  it("rejects an invalid type", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/approvals"]), userId: "u1" });
    asRejectedOwnedBy("u1");
    const res = await resubmitPost(
      jsonReq("http://t/api/finance/approvals/p1/resubmit", {
        proposed: validProposed({ type: "Wibble" }),
      }) as never,
      { params: { id: "p1" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_type" });
  });

  it("rejects a Revenue resubmit missing EXP/DOM", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/approvals"]), userId: "u1" });
    asRejectedOwnedBy("u1");
    const res = await resubmitPost(
      jsonReq("http://t/api/finance/approvals/p1/resubmit", {
        proposed: validProposed({ expDom: null }),
      }) as never,
      { params: { id: "p1" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expDom_required" });
  });

  it("accepts a valid resubmit and flips the row back to pending", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/approvals"]), userId: "u1" });
    asRejectedOwnedBy("u1");
    pendingUpdate.mockResolvedValue({ id: "p1", status: "pending" });
    const res = await resubmitPost(
      jsonReq("http://t/api/finance/approvals/p1/resubmit", { proposed: validProposed() }) as never,
      { params: { id: "p1" } },
    );
    expect(res.status).toBe(200);
    expect(pendingUpdate).toHaveBeenCalledTimes(1);
    // The stored proposal carries the server-derived month, not any client value.
    const stored = pendingUpdate.mock.calls[0][0].data.proposed as { month: string };
    expect(stored.month).toBe("Jul-26");
  });
});

describe("PATCH /api/finance/drafts/[id] — strict validation", () => {
  it("returns 403 without the Approvals page and never updates the draft", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/overview"]), userId: "u1" });
    const res = await draftPatch(
      jsonReq("http://t/api/finance/drafts/d1", validProposed(), "PATCH") as never,
      { params: { id: "d1" } },
    );
    expect(res.status).toBe(403);
    expect(updateDraftMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown category before touching the draft", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/approvals"]), userId: "u1" });
    verifyCat.mockResolvedValue("category_not_found");
    const res = await draftPatch(
      jsonReq("http://t/api/finance/drafts/d1", validProposed({ category: "Ghost" }), "PATCH") as never,
      { params: { id: "d1" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "category_not_found" });
    expect(updateDraftMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown sub-item", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/approvals"]), userId: "u1" });
    verifyCat.mockResolvedValue("sub_item_not_found");
    const res = await draftPatch(
      jsonReq("http://t/api/finance/drafts/d1", validProposed({ subItem: "Ghost" }), "PATCH") as never,
      { params: { id: "d1" } },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "sub_item_not_found" });
    expect(updateDraftMock).not.toHaveBeenCalled();
  });

  it("applies a valid draft edit with the derived month", async () => {
    getPerms.mockResolvedValue({ perms: perms(["/finance/approvals"]), userId: "u1" });
    updateDraftMock.mockResolvedValue({ ok: true, draft: { id: "d1" } });
    const res = await draftPatch(
      jsonReq("http://t/api/finance/drafts/d1", validProposed({ month: "Jan-27" }), "PATCH") as never,
      { params: { id: "d1" } },
    );
    expect(res.status).toBe(200);
    expect(updateDraftMock).toHaveBeenCalledTimes(1);
    expect(updateDraftMock.mock.calls[0][0].data.month).toBe("Jul-26");
  });
});
