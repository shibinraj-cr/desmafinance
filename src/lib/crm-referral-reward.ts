/**
 * Referral rewards — the database side. The rules (amount, ledger line, what
 * enrolling or un-enrolling does) are pure and live in ./crm-referral-link.ts.
 *
 * Lifecycle of one reward:
 *   due        raised inside the enrollment transaction of a referred lead
 *   paid       Finance paid the candidate; an Expense draft (Commissions ›
 *              Commissions) lands in the draft-first reviewer's My Drafts
 *   cancelled  the referred lead was un-enrolled before payment, or Finance
 *              cancelled it with a reason
 *
 * Every write claims the row by its current status (`updateMany where status`),
 * so two Finance users clicking at once can't pay one reward twice.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { recordLeadActivity } from "./crm-activity";
import { monthCodeFromDate, flowFor } from "./catalog";
import { badRequest, conflict, notFound } from "./http-error";
import {
  REFERRAL_REWARD_AMOUNT,
  REFERRAL_REWARD_LEDGER,
  referralRewardDescription,
  rewardOnEnroll,
  sameReferralIdentity,
} from "./crm-referral-link";

type Tx = Prisma.TransactionClient;

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Note a reward event on a lead's timeline without making the lead look worked. */
async function note(leadId: string | null, actorId: string | null, summary: string, metadata: Record<string, unknown>) {
  if (!leadId) return;
  await recordLeadActivity({ leadId, actorId, type: "REFERRAL_REWARD", summary, metadata });
}

/**
 * Raise (or reopen) the reward for a referred lead that is enrolling. Called
 * inside the enrollment transaction, so a reward exists exactly when the
 * enrollment does. Returns what happened, for the caller's timeline entries.
 */
export async function raiseReferralReward(
  tx: Tx,
  p: { referredLeadId: string; referredName: string; referrerLeadId: string },
): Promise<{ id: string; amount: number; referrerName: string; action: "create" | "reopen" } | null> {
  const referrer = await tx.lead.findUnique({ where: { id: p.referrerLeadId }, select: { candidateName: true } });
  if (!referrer) return null;
  const existing = await tx.crmReferralReward.findUnique({
    where: { referredLeadId: p.referredLeadId },
    select: { id: true, status: true, amount: true },
  });
  const action = rewardOnEnroll(existing);
  if (action === "keep") return null;
  if (action === "reopen" && existing) {
    await tx.crmReferralReward.update({
      where: { id: existing.id },
      data: {
        status: "due",
        dueAt: new Date(),
        cancelledAt: null,
        cancelReason: null,
        referrerLeadId: p.referrerLeadId,
        referrerName: referrer.candidateName,
        referredName: p.referredName,
      },
    });
    return { id: existing.id, amount: Number(existing.amount), referrerName: referrer.candidateName, action };
  }
  const created = await tx.crmReferralReward.create({
    data: {
      referredLeadId: p.referredLeadId,
      referredName: p.referredName,
      referrerLeadId: p.referrerLeadId,
      referrerName: referrer.candidateName,
      amount: REFERRAL_REWARD_AMOUNT,
    },
    select: { id: true },
  });
  return { id: created.id, amount: REFERRAL_REWARD_AMOUNT, referrerName: referrer.candidateName, action: "create" };
}

/** Timeline entries after a reward was raised by an enrollment (outside the transaction). */
export async function noteRewardRaised(
  r: { id: string; amount: number; referrerName: string; action: "create" | "reopen" },
  p: { referredLeadId: string; referredName: string; referrerLeadId: string; actorId: string | null },
): Promise<void> {
  const verb = r.action === "reopen" ? "due again" : "due";
  await note(p.referredLeadId, p.actorId, `Referral reward ${inr(r.amount)} ${verb} to ${r.referrerName}`, { rewardId: r.id });
  await note(p.referrerLeadId, p.actorId, `Referral reward ${inr(r.amount)} ${verb}: ${p.referredName} enrolled`, { rewardId: r.id });
}

/** The reward on a referred lead, as un-enrolling sees it. */
export async function rewardForUnenroll(referredLeadId: string) {
  return prisma.crmReferralReward.findUnique({
    where: { referredLeadId },
    select: { id: true, status: true, amount: true, referrerName: true, referrerLeadId: true, paidOn: true },
  });
}

// ── Finance ─────────────────────────────────────────────────────────────────

export type PayRewardInput = { rewardId: string; paidOn: Date; paymentMode: string; reference: string | null; actorId: string };

/**
 * Mark a reward paid and draft the expense. The draft goes to the draft-first
 * reviewer's My Drafts, like an enrollment's revenue; with no reviewer set up,
 * to the person paying. The referrer's candidate record rides along as the
 * party when it can carry an Expense.
 */
export async function payReferralReward(i: PayRewardInput): Promise<{ draftId: string; reviewer: string | null }> {
  const reward = await prisma.crmReferralReward.findUnique({
    where: { id: i.rewardId },
    select: {
      id: true,
      status: true,
      amount: true,
      referrerName: true,
      referredName: true,
      referrerLeadId: true,
      referredLeadId: true,
      referrerLead: { select: { party: { select: { id: true, txTypes: true, isActive: true } } } },
    },
  });
  if (!reward) throw notFound("That reward doesn't exist.");
  if (reward.status !== "due") throw conflict(`This reward is already ${reward.status}.`, "reward_not_due");

  const reviewer = await prisma.user.findFirst({ where: { draftFirst: true, isActive: true }, select: { id: true, username: true } });
  const party = reward.referrerLead?.party;
  const partyId = party && party.isActive && party.txTypes !== "Revenue" ? party.id : null;
  const amount = Number(reward.amount);

  const draftId = await prisma.$transaction(async (tx) => {
    const claimed = await tx.crmReferralReward.updateMany({
      where: { id: reward.id, status: "due" },
      data: {
        status: "paid",
        paidOn: i.paidOn,
        paymentMode: i.paymentMode,
        reference: i.reference,
        paidAt: new Date(),
        paidById: i.actorId,
      },
    });
    if (claimed.count !== 1) throw conflict("Someone else has just updated this reward. Refresh and check.", "reward_not_due");
    const draft = await tx.transactionDraft.create({
      data: {
        submittedById: reviewer?.id ?? i.actorId,
        date: i.paidOn,
        month: monthCodeFromDate(i.paidOn),
        type: REFERRAL_REWARD_LEDGER.type,
        category: REFERRAL_REWARD_LEDGER.category,
        subItem: REFERRAL_REWARD_LEDGER.subItem,
        description: referralRewardDescription({ ...reward, reference: i.reference }),
        paymentMode: i.paymentMode,
        amount,
        flow: flowFor(REFERRAL_REWARD_LEDGER.type),
        partyId,
        expDom: null,
      },
      select: { id: true },
    });
    await tx.crmReferralReward.update({ where: { id: reward.id }, data: { draftId: draft.id } });
    return draft.id;
  });

  const meta = { rewardId: reward.id, draftId };
  await note(reward.referrerLeadId, i.actorId, `Referral reward ${inr(amount)} paid for referring ${reward.referredName}`, meta);
  await note(reward.referredLeadId, i.actorId, `Referral reward ${inr(amount)} paid to ${reward.referrerName}`, meta);
  return { draftId, reviewer: reviewer?.username ?? null };
}

/**
 * Undo "Mark paid" — only while its draft still sits untouched in My Drafts,
 * where taking it back is safe. Once the draft has gone on to approval or the
 * ledger, Finance reverses it there instead.
 */
export async function undoReferralRewardPayment(rewardId: string, actorId: string): Promise<void> {
  const reward = await prisma.crmReferralReward.findUnique({
    where: { id: rewardId },
    select: { id: true, status: true, draftId: true, amount: true, referrerLeadId: true, referredLeadId: true, referredName: true },
  });
  if (!reward) throw notFound("That reward doesn't exist.");
  if (reward.status !== "paid") throw conflict("Only a paid reward can be taken back.", "reward_not_paid");
  const draft = reward.draftId
    ? await prisma.transactionDraft.findUnique({ where: { id: reward.draftId }, select: { id: true } })
    : null;
  if (!draft) {
    throw conflict(
      "Its expense draft has already left My Drafts, so it can't be undone here. Reverse the entry in Finance.",
      "reward_draft_moved",
    );
  }
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.crmReferralReward.updateMany({
      where: { id: reward.id, status: "paid" },
      data: { status: "due", paidOn: null, paymentMode: null, reference: null, paidAt: null, paidById: null, draftId: null },
    });
    if (claimed.count !== 1) throw conflict("Someone else has just updated this reward. Refresh and check.", "reward_not_paid");
    await tx.transactionDraft.delete({ where: { id: draft.id } });
  });
  const summary = `Referral reward payment for ${reward.referredName} taken back — due again`;
  await note(reward.referrerLeadId, actorId, summary, { rewardId: reward.id });
}

/** Cancel an unpaid reward, with the reason Finance gives. */
export async function cancelReferralReward(rewardId: string, reason: string, actorId: string): Promise<void> {
  const reward = await prisma.crmReferralReward.findUnique({
    where: { id: rewardId },
    select: { id: true, amount: true, referrerLeadId: true, referredName: true },
  });
  if (!reward) throw notFound("That reward doesn't exist.");
  const claimed = await prisma.crmReferralReward.updateMany({
    where: { id: rewardId, status: "due" },
    data: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason },
  });
  if (claimed.count !== 1) throw conflict("Only a reward that is due can be cancelled.", "reward_not_due");
  await note(reward.referrerLeadId, actorId, `Referral reward for ${reward.referredName} cancelled: ${reason}`, { rewardId });
}

/** Put a cancelled reward back to due — only while the referred lead is still enrolled. */
export async function restoreReferralReward(rewardId: string, actorId: string): Promise<void> {
  const reward = await prisma.crmReferralReward.findUnique({
    where: { id: rewardId },
    select: { id: true, status: true, referrerLeadId: true, referredName: true, referredLead: { select: { status: { select: { code: true } } } } },
  });
  if (!reward) throw notFound("That reward doesn't exist.");
  if (reward.referredLead?.status.code !== "enrolled") {
    throw badRequest("The referred candidate isn't enrolled any more, so the reward can't be due.", "referred_not_enrolled");
  }
  const claimed = await prisma.crmReferralReward.updateMany({
    where: { id: rewardId, status: "cancelled" },
    data: { status: "due", cancelledAt: null, cancelReason: null, dueAt: new Date() },
  });
  if (claimed.count !== 1) throw conflict("Only a cancelled reward can be restored.", "reward_not_cancelled");
  await note(reward.referrerLeadId, actorId, `Referral reward for ${reward.referredName} restored — due again`, { rewardId });
}

// ── Referred by, set by hand ────────────────────────────────────────────────

const IDENTITY = { id: true, candidateName: true, phoneE164: true, altPhoneE164: true, emailKey: true } as const;

/**
 * Check a hand-picked referrer: it exists, isn't the lead itself, and isn't the
 * same person under another record. Returns the referrer's name.
 */
export async function validateReferrer(
  referrerLeadId: string,
  lead: { id?: string; phoneE164: string | null; altPhoneE164: string | null; emailKey: string | null },
): Promise<{ id: string; candidateName: string }> {
  if (lead.id && lead.id === referrerLeadId) throw badRequest("A lead can't refer itself.", "referrer_self");
  const referrer = await prisma.lead.findUnique({ where: { id: referrerLeadId }, select: IDENTITY });
  if (!referrer) throw badRequest("That referring candidate isn't in the CRM.", "referrer_not_found");
  if (sameReferralIdentity(referrer, lead)) {
    throw badRequest("That's the same person — they share a phone number or email.", "referrer_same_person");
  }
  return { id: referrer.id, candidateName: referrer.candidateName };
}

/**
 * Set or clear who referred a lead, after it was created. A paid reward pins
 * the referrer; an unpaid one follows the change (or is cancelled when the
 * referrer is cleared); an enrolled lead that gains a referrer earns one now.
 */
export async function setReferredBy(leadId: string, referrerLeadId: string | null, actorId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { ...IDENTITY, referredByLeadId: true, status: { select: { code: true } } },
  });
  if (!lead) throw notFound();
  if ((lead.referredByLeadId ?? null) === referrerLeadId) return;

  const referrer = referrerLeadId ? await validateReferrer(referrerLeadId, lead) : null;
  const reward = await prisma.crmReferralReward.findUnique({ where: { referredLeadId: leadId }, select: { id: true, status: true } });
  if (reward?.status === "paid") {
    throw conflict("The reward for this referral is already paid, so who referred them can't change.", "reward_paid");
  }

  const raised = await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id: leadId }, data: { referredByLeadId: referrer?.id ?? null } });
    if (reward?.status === "due") {
      if (referrer) {
        await tx.crmReferralReward.update({
          where: { id: reward.id },
          data: { referrerLeadId: referrer.id, referrerName: referrer.candidateName },
        });
      } else {
        await tx.crmReferralReward.update({
          where: { id: reward.id },
          data: { status: "cancelled", cancelledAt: new Date(), cancelReason: "Referred by was cleared" },
        });
      }
      return null;
    }
    if (referrer && lead.status.code === "enrolled") {
      return raiseReferralReward(tx, { referredLeadId: leadId, referredName: lead.candidateName, referrerLeadId: referrer.id });
    }
    return null;
  });

  await recordLeadActivity({
    leadId,
    actorId,
    type: "FIELD_UPDATED",
    summary: referrer ? `Referred by set to ${referrer.candidateName}` : "Referred by cleared",
    metadata: { field: "referredByLeadId", from: lead.referredByLeadId, to: referrer?.id ?? null },
  });
  if (raised && referrer) {
    await noteRewardRaised(raised, { referredLeadId: leadId, referredName: lead.candidateName, referrerLeadId: referrer.id, actorId });
  }
}

// ── The Finance page ────────────────────────────────────────────────────────

export type RewardRow = {
  id: string;
  status: "due" | "paid" | "cancelled";
  amount: number;
  referredName: string;
  referredLeadId: string | null;
  referredService: string | null;
  enrolledOn: string;
  referrerName: string;
  referrerLeadId: string | null;
  /** How to reach the candidate to pay them. */
  referrerPhone: string | null;
  referrerEmail: string | null;
  paidOn: string | null;
  paymentMode: string | null;
  reference: string | null;
  paidBy: string | null;
  /** The expense draft is still in My Drafts (so "Undo" is possible). */
  draftPending: boolean;
  cancelReason: string | null;
  cancelledAt: string | null;
  unenrolledAfterPaid: boolean;
};

export async function listReferralRewards(): Promise<RewardRow[]> {
  const rows = await prisma.crmReferralReward.findMany({
    orderBy: [{ dueAt: "desc" }],
    take: 500,
    include: {
      referredLead: { select: { service: { select: { name: true } } } },
      referrerLead: { select: { phone: true, email: true } },
      paidBy: { select: { username: true } },
    },
  });
  const draftIds = rows.map((r) => r.draftId).filter((d): d is string => !!d);
  const pending = new Set(
    draftIds.length
      ? (await prisma.transactionDraft.findMany({ where: { id: { in: draftIds } }, select: { id: true } })).map((d) => d.id)
      : [],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status as RewardRow["status"],
    amount: Number(r.amount),
    referredName: r.referredName,
    referredLeadId: r.referredLeadId,
    referredService: r.referredLead?.service?.name ?? null,
    enrolledOn: r.dueAt.toISOString(),
    referrerName: r.referrerName,
    referrerLeadId: r.referrerLeadId,
    referrerPhone: r.referrerLead?.phone ?? null,
    referrerEmail: r.referrerLead?.email ?? null,
    paidOn: r.paidOn ? r.paidOn.toISOString().slice(0, 10) : null,
    paymentMode: r.paymentMode,
    reference: r.reference,
    paidBy: r.paidBy?.username ?? null,
    draftPending: !!r.draftId && pending.has(r.draftId),
    cancelReason: r.cancelReason,
    cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
    unenrolledAfterPaid: !!r.unenrolledAfterPaidAt,
  }));
}
