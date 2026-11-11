/**
 * Referral rewards: the pure rules, raising one on enrollment, Finance paying
 * (and the expense draft it raises), undo / cancel / restore, setting Referred
 * by by hand, and who may reach each route. Prisma is mocked; the transaction
 * client is the same mock, so writes inside and outside it are both visible.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const m = {
    lead: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    crmReferralReward: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    transactionDraft: { create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    user: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  m.$transaction.mockImplementation(async (cb: (tx: typeof m) => unknown) => cb(m));
  return m;
});
const activity = vi.hoisted(() => vi.fn());
const perms = vi.hoisted(() => ({ pages: ["/finance/referral-rewards"] as string[], isAdmin: false }));
const access = vi.hoisted(() => ({ canViewLeads: true, canAssign: true }));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/crm-activity", () => ({ recordLeadActivity: activity }));
vi.mock("@/lib/permissions", () => ({
  getCurrentUserAndPermissions: vi.fn(async () => ({
    userId: "fin1",
    perms: { isAdmin: perms.isAdmin, canApprove: false, needsApproval: true, draftFirst: false, pages: perms.pages, roleName: "Finance Executive" },
  })),
}));
vi.mock("@/lib/crm-rbac", () => ({ getCrmAccess: vi.fn(async () => access) }));

import {
  REFERRAL_REWARD_AMOUNT,
  referralRewardDescription,
  rewardOnEnroll,
  rewardOnUnenroll,
  sameReferralIdentity,
} from "@/lib/crm-referral-link";
import {
  cancelReferralReward,
  payReferralReward,
  raiseReferralReward,
  restoreReferralReward,
  setReferredBy,
  undoReferralRewardPayment,
  validateReferrer,
} from "@/lib/crm-referral-reward";
import { POST as rewardRoute } from "@/app/api/finance/referral-rewards/[id]/route";
import { PATCH as referredByRoute } from "@/app/api/crm/leads/[id]/referred-by/route";
import type { Prisma } from "@prisma/client";

const tx = db as unknown as Prisma.TransactionClient;
const PAID_ON = new Date("2026-11-11T00:00:00.000Z");

function dueReward(over: Record<string, unknown> = {}) {
  return {
    id: "rw1",
    status: "due",
    amount: { toString: () => "5000" },
    referrerName: "Asha Kumar",
    referredName: "Kiran Das",
    referrerLeadId: "asha",
    referredLeadId: "kiran",
    referrerLead: { party: { id: "party-asha", txTypes: "Both", isActive: true } },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (cb: (t: typeof db) => unknown) => cb(db));
  perms.pages = ["/finance/referral-rewards"];
  perms.isAdmin = false;
  access.canViewLeads = true;
  access.canAssign = true;
  db.crmReferralReward.updateMany.mockResolvedValue({ count: 1 });
  db.transactionDraft.create.mockResolvedValue({ id: "draft1" });
  db.user.findFirst.mockResolvedValue({ id: "reviewer1", username: "reviewer" });
});

// ── Pure rules ──────────────────────────────────────────────────────────────

describe("rules", () => {
  it("raises once per referred person, reopening only a cancelled one", () => {
    expect(rewardOnEnroll(null)).toBe("create");
    expect(rewardOnEnroll({ status: "cancelled" })).toBe("reopen");
    expect(rewardOnEnroll({ status: "due" })).toBe("keep");
    expect(rewardOnEnroll({ status: "paid" })).toBe("keep");
  });

  it("cancels an unpaid reward on un-enroll, flags a paid one", () => {
    expect(rewardOnUnenroll({ status: "due" })).toBe("cancel");
    expect(rewardOnUnenroll({ status: "paid" })).toBe("flag");
    expect(rewardOnUnenroll({ status: "cancelled" })).toBe("none");
    expect(rewardOnUnenroll(null)).toBe("none");
  });

  it("knows the same person across phone, alt phone and email", () => {
    const a = { phoneE164: "+911", altPhoneE164: null, emailKey: "a@x.com" };
    expect(sameReferralIdentity(a, { phoneE164: null, altPhoneE164: "+911", emailKey: null })).toBe(true);
    expect(sameReferralIdentity(a, { phoneE164: "+912", altPhoneE164: null, emailKey: "a@x.com" })).toBe(true);
    expect(sameReferralIdentity(a, { phoneE164: "+912", altPhoneE164: null, emailKey: null })).toBe(false);
    expect(sameReferralIdentity({ phoneE164: null, altPhoneE164: null, emailKey: null }, { phoneE164: null, altPhoneE164: null, emailKey: null })).toBe(false);
  });

  it("describes the expense the way Finance will read it", () => {
    expect(referralRewardDescription({ referrerName: "Asha", referredName: "Kiran", reference: " UTR9 " })).toBe(
      "Referral reward — Asha for referring Kiran · ref UTR9",
    );
    expect(referralRewardDescription({ referrerName: "Asha", referredName: "Kiran" })).toBe("Referral reward — Asha for referring Kiran");
  });

  it("is a flat ₹5,000", () => {
    expect(REFERRAL_REWARD_AMOUNT).toBe(5000);
  });
});

// ── Raised on enrollment ────────────────────────────────────────────────────

describe("raiseReferralReward", () => {
  const args = { referredLeadId: "kiran", referredName: "Kiran Das", referrerLeadId: "asha" };

  it("raises a due ₹5,000 reward naming both candidates", async () => {
    db.lead.findUnique.mockResolvedValue({ candidateName: "Asha Kumar" });
    db.crmReferralReward.findUnique.mockResolvedValue(null);
    db.crmReferralReward.create.mockResolvedValue({ id: "rw1" });

    const r = await raiseReferralReward(tx, args);
    expect(r).toEqual({ id: "rw1", amount: 5000, referrerName: "Asha Kumar", action: "create" });
    expect(db.crmReferralReward.create).toHaveBeenCalledWith({
      data: { referredLeadId: "kiran", referredName: "Kiran Das", referrerLeadId: "asha", referrerName: "Asha Kumar", amount: 5000 },
      select: { id: true },
    });
  });

  it("reopens a reward cancelled by an earlier un-enroll", async () => {
    db.lead.findUnique.mockResolvedValue({ candidateName: "Asha Kumar" });
    db.crmReferralReward.findUnique.mockResolvedValue({ id: "rw1", status: "cancelled", amount: { toString: () => "5000" } });
    const r = await raiseReferralReward(tx, args);
    expect(r?.action).toBe("reopen");
    expect(db.crmReferralReward.update.mock.calls[0][0].data).toMatchObject({ status: "due", cancelledAt: null, cancelReason: null });
  });

  it("never owes twice for one person", async () => {
    db.lead.findUnique.mockResolvedValue({ candidateName: "Asha Kumar" });
    for (const status of ["due", "paid"]) {
      db.crmReferralReward.findUnique.mockResolvedValue({ id: "rw1", status, amount: 5000 });
      expect(await raiseReferralReward(tx, args)).toBeNull();
    }
    expect(db.crmReferralReward.create).not.toHaveBeenCalled();
  });

  it("does nothing when the referrer's lead is gone", async () => {
    db.lead.findUnique.mockResolvedValue(null);
    expect(await raiseReferralReward(tx, args)).toBeNull();
  });
});

// ── Finance ─────────────────────────────────────────────────────────────────

describe("payReferralReward", () => {
  const pay = (over = {}) =>
    payReferralReward({ rewardId: "rw1", paidOn: PAID_ON, paymentMode: "UPI", reference: "UTR123", actorId: "fin1", ...over });

  it("marks it paid and drafts the expense to Commissions › Commissions in the reviewer's My Drafts", async () => {
    db.crmReferralReward.findUnique.mockResolvedValue(dueReward());
    const res = await pay();

    expect(res).toEqual({ draftId: "draft1", reviewer: "reviewer" });
    expect(db.crmReferralReward.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "rw1", status: "due" },
      data: { status: "paid", paidOn: PAID_ON, paymentMode: "UPI", reference: "UTR123", paidById: "fin1" },
    });
    expect(db.transactionDraft.create.mock.calls[0][0].data).toEqual({
      submittedById: "reviewer1",
      date: PAID_ON,
      month: expect.any(String),
      type: "Expense",
      category: "Commissions",
      subItem: "Commissions",
      description: "Referral reward — Asha Kumar for referring Kiran Das · ref UTR123",
      paymentMode: "UPI",
      amount: 5000,
      flow: "Outflow",
      partyId: "party-asha",
      expDom: null,
    });
    expect(db.crmReferralReward.update).toHaveBeenCalledWith({ where: { id: "rw1" }, data: { draftId: "draft1" } });
    // Both timelines hear about it, without bumping either lead.
    expect(activity.mock.calls.map((c) => [c[0].leadId, c[0].type])).toEqual([
      ["asha", "REFERRAL_REWARD"],
      ["kiran", "REFERRAL_REWARD"],
    ]);
  });

  it("drafts to the person paying when no reviewer is set up, and leaves out a Revenue-only party", async () => {
    db.user.findFirst.mockResolvedValue(null);
    db.crmReferralReward.findUnique.mockResolvedValue(dueReward({ referrerLead: { party: { id: "p", txTypes: "Revenue", isActive: true } } }));
    await pay();
    expect(db.transactionDraft.create.mock.calls[0][0].data).toMatchObject({ submittedById: "fin1", partyId: null });
  });

  it("refuses a reward that isn't due, and loses a race cleanly", async () => {
    db.crmReferralReward.findUnique.mockResolvedValue(dueReward({ status: "paid" }));
    await expect(pay()).rejects.toMatchObject({ status: 409, code: "reward_not_due" });

    db.crmReferralReward.findUnique.mockResolvedValue(dueReward());
    db.crmReferralReward.updateMany.mockResolvedValue({ count: 0 });
    await expect(pay()).rejects.toMatchObject({ status: 409 });
    expect(db.transactionDraft.create).not.toHaveBeenCalled();
  });
});

describe("undo / cancel / restore", () => {
  it("takes a payment back while its draft is still in My Drafts", async () => {
    db.crmReferralReward.findUnique.mockResolvedValue(dueReward({ status: "paid", draftId: "draft1" }));
    db.transactionDraft.findUnique.mockResolvedValue({ id: "draft1" });
    await undoReferralRewardPayment("rw1", "fin1");
    expect(db.crmReferralReward.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "rw1", status: "paid" },
      data: { status: "due", draftId: null, paidOn: null },
    });
    expect(db.transactionDraft.delete).toHaveBeenCalledWith({ where: { id: "draft1" } });
  });

  it("won't undo once the draft has moved on", async () => {
    db.crmReferralReward.findUnique.mockResolvedValue(dueReward({ status: "paid", draftId: "draft1" }));
    db.transactionDraft.findUnique.mockResolvedValue(null);
    await expect(undoReferralRewardPayment("rw1", "fin1")).rejects.toMatchObject({ status: 409, code: "reward_draft_moved" });
    expect(db.crmReferralReward.updateMany).not.toHaveBeenCalled();
  });

  it("cancels only a due reward", async () => {
    db.crmReferralReward.findUnique.mockResolvedValue(dueReward());
    await cancelReferralReward("rw1", "Duplicate referral", "fin1");
    expect(db.crmReferralReward.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "rw1", status: "due" },
      data: { status: "cancelled", cancelReason: "Duplicate referral" },
    });
    db.crmReferralReward.updateMany.mockResolvedValue({ count: 0 });
    await expect(cancelReferralReward("rw1", "again", "fin1")).rejects.toMatchObject({ status: 409 });
  });

  it("restores a cancelled reward only while the referred candidate is enrolled", async () => {
    db.crmReferralReward.findUnique.mockResolvedValue({ ...dueReward({ status: "cancelled" }), referredLead: { status: { code: "follow_up" } } });
    await expect(restoreReferralReward("rw1", "fin1")).rejects.toMatchObject({ status: 400, code: "referred_not_enrolled" });

    db.crmReferralReward.findUnique.mockResolvedValue({ ...dueReward({ status: "cancelled" }), referredLead: { referredByLeadId: null, status: { code: "enrolled" } } });
    await expect(restoreReferralReward("rw1", "fin1")).rejects.toMatchObject({ status: 400, code: "referrer_removed" });

    db.crmReferralReward.findUnique.mockResolvedValue({ ...dueReward({ status: "cancelled" }), referredLead: { referredByLeadId: "asha", status: { code: "enrolled" } } });
    await restoreReferralReward("rw1", "fin1");
    expect(db.crmReferralReward.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "rw1", status: "cancelled" }, data: { status: "due" } });
  });
});

// ── Referred by, by hand ────────────────────────────────────────────────────

const ASHA = { id: "asha", candidateName: "Asha Kumar", phoneE164: "+919847000001", altPhoneE164: null, emailKey: "asha@example.com" };
const MEERA = { id: "meera", candidateName: "Meera Nair", phoneE164: "+919847000002", altPhoneE164: null, emailKey: null };
function kiran(over: Record<string, unknown> = {}) {
  return { id: "kiran", candidateName: "Kiran Das", phoneE164: "+919847012345", altPhoneE164: null, emailKey: null, referredByLeadId: null, status: { code: "follow_up" }, ...over };
}
function leads(map: Record<string, unknown>) {
  db.lead.findUnique.mockImplementation(async (args: { where: { id: string } }) => map[args.where.id] ?? null);
}

describe("validateReferrer", () => {
  it("refuses the lead itself and the same person under another record", async () => {
    await expect(validateReferrer("kiran", { id: "kiran", phoneE164: null, altPhoneE164: null, emailKey: null })).rejects.toMatchObject({ code: "referrer_self" });
    leads({ asha: ASHA });
    await expect(validateReferrer("asha", { phoneE164: "+919847000001", altPhoneE164: null, emailKey: null })).rejects.toMatchObject({
      code: "referrer_same_person",
    });
    await expect(validateReferrer("ghost", { phoneE164: null, altPhoneE164: null, emailKey: null })).rejects.toMatchObject({ code: "referrer_not_found" });
    expect(await validateReferrer("asha", { phoneE164: "+919847012345", altPhoneE164: null, emailKey: null })).toEqual({ id: "asha", candidateName: "Asha Kumar" });
  });
});

describe("setReferredBy", () => {
  it("pins the referrer once the reward is paid", async () => {
    leads({ kiran: kiran({ referredByLeadId: "asha" }), meera: MEERA });
    db.crmReferralReward.findUnique.mockResolvedValue({ id: "rw1", status: "paid" });
    await expect(setReferredBy("kiran", "meera", "madmin")).rejects.toMatchObject({ status: 409, code: "reward_paid" });
    expect(db.lead.update).not.toHaveBeenCalled();
  });

  it("moves an unpaid reward to the new referrer", async () => {
    leads({ kiran: kiran({ referredByLeadId: "asha", status: { code: "enrolled" } }), meera: MEERA });
    db.crmReferralReward.findUnique.mockResolvedValue({ id: "rw1", status: "due" });
    await setReferredBy("kiran", "meera", "madmin");
    expect(db.lead.update).toHaveBeenCalledWith({ where: { id: "kiran" }, data: { referredByLeadId: "meera" } });
    expect(db.crmReferralReward.update).toHaveBeenCalledWith({ where: { id: "rw1" }, data: { referrerLeadId: "meera", referrerName: "Meera Nair" } });
  });

  it("cancels a due reward when Referred by is removed", async () => {
    leads({ kiran: kiran({ referredByLeadId: "asha", status: { code: "enrolled" } }) });
    db.crmReferralReward.findUnique.mockResolvedValue({ id: "rw1", status: "due" });
    await setReferredBy("kiran", null, "madmin");
    expect(db.lead.update).toHaveBeenCalledWith({ where: { id: "kiran" }, data: { referredByLeadId: null } });
    expect(db.crmReferralReward.update.mock.calls[0][0].data).toMatchObject({ status: "cancelled", cancelReason: "Referred by was removed" });
  });

  it("moves a cancelled reward to the new referrer too, so a restore pays the right person", async () => {
    leads({ kiran: kiran({ referredByLeadId: "asha" }), meera: MEERA });
    db.crmReferralReward.findUnique.mockResolvedValue({ id: "rw1", status: "cancelled" });
    await setReferredBy("kiran", "meera", "madmin");
    expect(db.crmReferralReward.update).toHaveBeenCalledWith({ where: { id: "rw1" }, data: { referrerLeadId: "meera", referrerName: "Meera Nair" } });
  });

  // Owner's rule: a lead already in the CRM is never counted as a referral.
  it("never adds a referrer to a lead that didn't have one — enrolled or not", async () => {
    for (const status of ["enrolled", "follow_up"]) {
      leads({ kiran: kiran({ status: { code: status } }), asha: ASHA });
      db.crmReferralReward.findUnique.mockResolvedValue(null);
      await expect(setReferredBy("kiran", "asha", "madmin")).rejects.toMatchObject({ status: 400, code: "referrer_only_at_creation" });
    }
    expect(db.lead.update).not.toHaveBeenCalled();
    expect(db.crmReferralReward.create).not.toHaveBeenCalled();
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

const post = (body: unknown) =>
  new Request("http://local/api/finance/referral-rewards/rw1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/finance/referral-rewards/[id]", () => {
  it("is Finance's: closed to anyone without the page", async () => {
    perms.pages = ["/finance/overview"];
    const res = await rewardRoute(post({ action: "cancel", reason: "test" }), { params: { id: "rw1" } });
    expect(res.status).toBe(403);
  });

  it("pays with a date, a known payment mode and an optional reference", async () => {
    db.crmReferralReward.findUnique.mockResolvedValue(dueReward());
    const bad = await rewardRoute(post({ action: "pay", paidOn: "2026-11-11", paymentMode: "Bitcoin" }), { params: { id: "rw1" } });
    expect(bad.status).toBe(400);
    const res = await rewardRoute(post({ action: "pay", paidOn: "2026-11-11", paymentMode: "UPI" }), { params: { id: "rw1" } });
    expect(res.status).toBe(200);
    expect(db.transactionDraft.create.mock.calls[0][0].data.date).toEqual(PAID_ON);
  });

  it("needs a reason to cancel", async () => {
    const res = await rewardRoute(post({ action: "cancel", reason: "" }), { params: { id: "rw1" } });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/crm/leads/[id]/referred-by", () => {
  const patch = (body: unknown) =>
    new Request("http://local/api/crm/leads/kiran/referred-by", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("is only for whoever hands out leads", async () => {
    access.canAssign = false;
    expect((await referredByRoute(patch({ referredByLeadId: "asha" }), { params: { id: "kiran" } })).status).toBe(403);
  });

  it("changes the referrer of a referred lead", async () => {
    leads({ kiran: kiran({ referredByLeadId: "asha" }), meera: MEERA });
    db.crmReferralReward.findUnique.mockResolvedValue(null);
    const res = await referredByRoute(patch({ referredByLeadId: "meera" }), { params: { id: "kiran" } });
    expect(res.status).toBe(200);
    expect(db.lead.update).toHaveBeenCalledWith({ where: { id: "kiran" }, data: { referredByLeadId: "meera" } });
  });

  it("refuses to make an existing lead a referral", async () => {
    leads({ kiran: kiran(), asha: ASHA });
    const res = await referredByRoute(patch({ referredByLeadId: "asha" }), { params: { id: "kiran" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("referrer_only_at_creation");
  });
});
