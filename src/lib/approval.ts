import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { recordAudit } from "./audit";
import { canApprove, canWorkSalaryDrafts, needsApproval, type Permissions } from "./rbac";
import { isHistoricalDate } from "./finance-historical";
import { guardLedgerWrite, invoiceBlocks, invoicedOrThrow, INVOICED } from "./invoices/ledger-lock";

export type TxProposed = {
  date: string; // ISO date
  month: string;
  type: string;
  category: string;
  subItem: string;
  description?: string | null;
  paymentMode: string;
  amount: number;
  flow: string;
  partyId?: string | null;
  /** Employee counterparty — salary / incentive outflows (Expense only).
   *  A transaction carries EITHER partyId OR employeeId. */
  employeeId?: string | null;
  /** "EXP" / "DOM" — required when type=Revenue, null on Expense. */
  expDom?: string | null;
};

/**
 * Submit a new transaction. Routing:
 *   1. perms.draftFirst → store as TransactionDraft (user reviews on
 *      My Drafts page before pushing to approval).
 *   2. canApprove → write directly to Transaction.
 *   3. needsApproval → enqueue PendingApproval.
 *
 * Returns one of:
 *   { applied: true, transaction }
 *   { applied: false, pending }
 *   { applied: false, draft, isDraft: true }
 */
export async function submitCreate(opts: {
  data: TxProposed;
  userId: string;
  perms: Permissions;
}) {
  const { data, userId, perms } = opts;

  // draftFirst takes priority — these users see all their entries on
  // My Drafts before anything reaches the approval queue.
  if (perms.draftFirst) {
    const draft = await prisma.transactionDraft.create({
      data: {
        submittedById: userId,
        date: new Date(data.date),
        month: data.month,
        type: data.type,
        category: data.category,
        subItem: data.subItem,
        description: data.description ?? null,
        paymentMode: data.paymentMode,
        amount: data.amount,
        flow: data.flow,
        partyId: data.partyId ?? null,
        employeeId: data.employeeId ?? null,
        expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
      },
    });
    await recordAudit({
      entityType: "TransactionDraft",
      entityId: draft.id,
      action: "DRAFT_CREATE",
      userId,
      changes: { ...data },
    });
    return { applied: false as const, draft, isDraft: true as const };
  }

  if (canApprove(perms)) {
    const created = await prisma.transaction.create({
      data: {
        date: new Date(data.date),
        month: data.month,
        type: data.type,
        category: data.category,
        subItem: data.subItem,
        description: data.description ?? null,
        paymentMode: data.paymentMode,
        amount: data.amount,
        flow: data.flow,
        partyId: data.partyId ?? null,
        employeeId: data.employeeId ?? null,
        expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
        isHistorical: isHistoricalDate(data.date),
        createdById: userId,
      },
    });
    await recordAudit({
      entityType: "Transaction",
      entityId: created.id,
      action: "CREATE",
      userId,
      changes: { ...data },
    });
    return { applied: true as const, transaction: created };
  }

  if (!needsApproval(perms)) throw new Error("unexpected role");
  const pending = await prisma.pendingApproval.create({
    data: {
      kind: "create",
      status: "pending",
      proposed: data as unknown as object,
      submittedById: userId,
    },
  });
  await recordAudit({
    entityType: "PendingApproval",
    entityId: pending.id,
    action: "SUBMIT_CREATE",
    userId,
    changes: { ...data },
  });
  return { applied: false as const, pending };
}

/** The drafts a user works on My Drafts: admins see everyone's (oversight),
 *  everyone else their own, and Finance also the salary drafts of approved
 *  runs, whose owner is the HR approver. */
export function draftScope(perms: Permissions, userId: string): Prisma.TransactionDraftWhereInput {
  if (perms.isAdmin && !perms.draftFirst) return {};
  if (!canWorkSalaryDrafts(perms)) return { submittedById: userId };
  return { OR: [{ submittedById: userId }, { salaryRunId: { not: null } }] };
}

/** Owner or admin; a salary draft is Finance's to work, whoever approved the run. */
function canActOnDraft(
  draft: { submittedById: string; salaryRunId: string | null },
  userId: string,
  perms: Permissions,
) {
  if (draft.salaryRunId) return canWorkSalaryDrafts(perms);
  return draft.submittedById === userId || perms.isAdmin;
}

/** Stamp a salary run as having left Finance's drafts. It can't be recomputed after this. */
async function markRunSubmitted(tx: Prisma.TransactionClient, salaryRunId: string | null) {
  if (!salaryRunId) return;
  await tx.hrSalaryRun.updateMany({
    where: { id: salaryRunId, financeSubmittedAt: null },
    data: { financeSubmittedAt: new Date() },
  });
}

/** Edit an existing draft. The owner can always edit; admins can edit
 *  any draft (so they can support Ganga's review if needed). */
export async function updateDraft(opts: {
  draftId: string;
  userId: string;
  perms: Permissions;
  data: TxProposed;
}) {
  const { draftId, userId, perms, data } = opts;
  const draft = await prisma.transactionDraft.findUnique({ where: { id: draftId } });
  if (!draft) return { error: "not_found" as const };
  if (!canActOnDraft(draft, userId, perms)) return { error: "forbidden" as const };
  const updated = await prisma.transactionDraft.update({
    where: { id: draftId },
    data: {
      date: new Date(data.date),
      month: data.month,
      type: data.type,
      category: data.category,
      subItem: data.subItem,
      description: data.description ?? null,
      paymentMode: data.paymentMode,
      amount: data.amount,
      flow: data.flow,
      partyId: data.partyId ?? null,
      employeeId: data.employeeId ?? null,
      expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
    },
  });
  await recordAudit({
    entityType: "TransactionDraft",
    entityId: draftId,
    action: "DRAFT_UPDATE",
    userId,
    changes: { ...data },
  });
  return { ok: true as const, draft: updated };
}

/** Discard a draft without submitting. Owner or admin. */
export async function discardDraft(opts: {
  draftId: string;
  userId: string;
  perms: Permissions;
}) {
  const { draftId, userId, perms } = opts;
  const draft = await prisma.transactionDraft.findUnique({ where: { id: draftId } });
  if (!draft) return { error: "not_found" as const };
  if (!canActOnDraft(draft, userId, perms)) return { error: "forbidden" as const };
  await prisma.transactionDraft.delete({ where: { id: draftId } });
  await recordAudit({
    entityType: "TransactionDraft",
    entityId: draftId,
    action: "DRAFT_DISCARD",
    userId,
    changes: {},
  });
  return { ok: true as const };
}

/** Promote a draft to a PendingApproval (or, if the submitter has
 *  somehow gained canApprove since, write directly to Transaction).
 *  Atomic: the draft is deleted in the same transaction that creates
 *  the downstream row. */
export async function submitDraftToPending(opts: {
  draftId: string;
  userId: string;
  perms: Permissions;
}) {
  const { draftId, userId, perms } = opts;
  const draft = await prisma.transactionDraft.findUnique({ where: { id: draftId } });
  if (!draft) return { error: "not_found" as const };
  // Owner or admin can submit. The downstream PendingApproval /
  // Transaction is always attributed to the *draft owner* — admins
  // who push on the preparer's behalf show up only in the audit log. A salary
  // draft goes to whoever in Finance pushed it instead: its owner is the
  // HR approver, who would never see a rejection to resubmit it.
  if (!canActOnDraft(draft, userId, perms)) return { error: "forbidden" as const };
  const ownerId = draft.salaryRunId ? userId : draft.submittedById;

  const proposed: TxProposed = {
    date: draft.date.toISOString(),
    month: draft.month,
    type: draft.type,
    category: draft.category,
    subItem: draft.subItem,
    description: draft.description,
    paymentMode: draft.paymentMode,
    amount: Number(draft.amount.toString()),
    flow: draft.flow,
    partyId: draft.partyId,
    employeeId: draft.employeeId,
    // EXP/DOM is only meaningful for Revenue; carry it through draft →
    // pending so reviewers (and the GST calc) see the classification.
    expDom: draft.type === "Revenue" ? (draft.expDom ?? null) : null,
  };

  if (canApprove(perms)) {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          date: draft.date,
          month: draft.month,
          type: draft.type,
          category: draft.category,
          subItem: draft.subItem,
          description: draft.description,
          paymentMode: draft.paymentMode,
          amount: draft.amount,
          flow: draft.flow,
          partyId: draft.partyId,
          employeeId: draft.employeeId,
          expDom: draft.type === "Revenue" ? (draft.expDom ?? null) : null,
          isHistorical: isHistoricalDate(draft.date),
          createdById: ownerId,
        },
      });
      await tx.transactionDraft.delete({ where: { id: draftId } });
      await markRunSubmitted(tx, draft.salaryRunId);
      return created;
    });
    await recordAudit({
      entityType: "Transaction",
      entityId: result.id,
      action: "CREATE",
      userId,
      changes: { ...proposed, fromDraftId: draftId, draftOwnerId: ownerId },
    });
    return { applied: true as const, transaction: result };
  }

  const pending = await prisma.$transaction(async (tx) => {
    const created = await tx.pendingApproval.create({
      data: {
        kind: "create",
        status: "pending",
        proposed: proposed as unknown as object,
        submittedById: ownerId,
      },
    });
    await tx.transactionDraft.delete({ where: { id: draftId } });
    await markRunSubmitted(tx, draft.salaryRunId);
    return created;
  });
  await recordAudit({
    entityType: "PendingApproval",
    entityId: pending.id,
    action: "SUBMIT_CREATE",
    userId,
    changes: { ...proposed, fromDraftId: draftId, draftOwnerId: ownerId },
  });
  return { applied: false as const, pending };
}

export async function submitUpdate(opts: {
  txId: string;
  data: TxProposed;
  userId: string;
  perms: Permissions;
}) {
  const { txId, data, userId, perms } = opts;
  const existing = await prisma.transaction.findUnique({ where: { id: txId } });
  if (!existing || existing.deletedAt) {
    return { error: "not_found" as const };
  }
  // An issued GST invoice freezes what it printed. Checked here so an
  // executive hears it at once, and again under the row lock when applied.
  if (await invoiceBlocks(prisma, existing, data)) {
    return { error: "invoiced" as const };
  }

  if (canApprove(perms)) {
    const updated = await prisma
      .$transaction(async (tx) => {
        await guardLedgerWrite(tx, txId, data);
        return tx.transaction.update({
          where: { id: txId },
          data: {
            date: new Date(data.date),
            month: data.month,
            type: data.type,
            category: data.category,
            subItem: data.subItem,
            description: data.description ?? null,
            paymentMode: data.paymentMode,
            amount: data.amount,
            flow: data.flow,
            partyId: data.partyId ?? null,
            employeeId: data.employeeId ?? null,
            expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
            isHistorical: isHistoricalDate(data.date),
          },
        });
      })
      .catch(invoicedOrThrow);
    if (updated === INVOICED) return { error: "invoiced" as const };
    await recordAudit({
      entityType: "Transaction",
      entityId: updated.id,
      action: "UPDATE",
      userId,
      changes: {
        before: txSnapshot(existing),
        after: data,
      },
    });
    return { applied: true as const, transaction: updated };
  }

  // Executive: upsert a single pending update for this target.
  // If there's already a pending update or delete for this tx, replace it.
  const pre = await prisma.pendingApproval.findFirst({
    where: { targetTxId: txId, status: "pending" },
  });
  let pending;
  if (pre) {
    pending = await prisma.pendingApproval.update({
      where: { id: pre.id },
      data: {
        kind: "update",
        proposed: data as unknown as object,
        submittedById: userId,
        updatedAt: new Date(),
      },
    });
  } else {
    pending = await prisma.pendingApproval.create({
      data: {
        kind: "update",
        status: "pending",
        targetTxId: txId,
        proposed: data as unknown as object,
        submittedById: userId,
      },
    });
  }
  await recordAudit({
    entityType: "PendingApproval",
    entityId: pending.id,
    action: "SUBMIT_UPDATE",
    userId,
    changes: {
      before: txSnapshot(existing),
      after: data,
    },
  });
  return { applied: false as const, pending };
}

export async function submitDelete(opts: {
  txId: string;
  userId: string;
  perms: Permissions;
}) {
  const { txId, userId, perms } = opts;
  const existing = await prisma.transaction.findUnique({ where: { id: txId } });
  if (!existing || existing.deletedAt) {
    return { error: "not_found" as const };
  }
  if (await invoiceBlocks(prisma, existing, null)) {
    return { error: "invoiced" as const };
  }

  if (canApprove(perms)) {
    const deleted = await prisma
      .$transaction(async (tx) => {
        await guardLedgerWrite(tx, txId, null);
        await tx.transaction.update({
          where: { id: txId },
          data: { deletedAt: new Date(), deletedById: userId },
        });
      })
      .catch(invoicedOrThrow);
    if (deleted === INVOICED) return { error: "invoiced" as const };
    await recordAudit({
      entityType: "Transaction",
      entityId: txId,
      action: "DELETE",
      userId,
      changes: txSnapshot(existing),
    });
    return { applied: true as const };
  }

  const pre = await prisma.pendingApproval.findFirst({
    where: { targetTxId: txId, status: "pending" },
  });
  let pending;
  if (pre) {
    pending = await prisma.pendingApproval.update({
      where: { id: pre.id },
      data: {
        kind: "delete",
        proposed: undefined,
        submittedById: userId,
        updatedAt: new Date(),
      },
    });
  } else {
    pending = await prisma.pendingApproval.create({
      data: {
        kind: "delete",
        status: "pending",
        targetTxId: txId,
        submittedById: userId,
      },
    });
  }
  await recordAudit({
    entityType: "PendingApproval",
    entityId: pending.id,
    action: "SUBMIT_DELETE",
    userId,
    changes: txSnapshot(existing),
  });
  return { applied: false as const, pending };
}

/** Thrown inside a $transaction when another reviewer resolved the pending first. */
class PendingAlreadyResolved extends Error {}

/**
 * Resolve a pending row only if it is STILL pending, as the first write of the
 * transaction. The status check before the transaction is just a fast path:
 * two reviewers (or a double-click, or Approve racing Bulk approve) can both
 * read "pending" there. Here Postgres row-locks the row; the second writer
 * waits, re-checks `status = 'pending'` after the first commits, matches
 * nothing, and its whole transaction rolls back, so revenue is never posted
 * twice and an approve can't overwrite a reject.
 */
async function claimPending(
  tx: Prisma.TransactionClient,
  pendingId: string,
  data: { status: "approved" | "rejected"; reviewedById: string; reviewNote: string | null },
): Promise<void> {
  const { count } = await tx.pendingApproval.updateMany({
    where: { id: pendingId, status: "pending" },
    data: { ...data, reviewedAt: new Date() },
  });
  if (count !== 1) throw new PendingAlreadyResolved();
}

/** Manager/admin approves a pending change → applies it to the canonical Transaction table. */
export async function approvePending(opts: {
  pendingId: string;
  reviewerId: string;
  reviewerPerms: Permissions;
  note?: string;
}) {
  try {
    return await approvePendingInner(opts);
  } catch (e) {
    if (e instanceof PendingAlreadyResolved) return { error: "already_resolved" as const };
    throw e;
  }
}

async function approvePendingInner(opts: {
  pendingId: string;
  reviewerId: string;
  reviewerPerms: Permissions;
  note?: string;
}) {
  const { pendingId, reviewerId, reviewerPerms, note } = opts;
  if (!canApprove(reviewerPerms)) return { error: "forbidden" as const };

  const p = await prisma.pendingApproval.findUnique({ where: { id: pendingId } });
  if (!p) return { error: "not_found" as const };
  if (p.status !== "pending") return { error: "already_resolved" as const };
  const resolution = {
    status: "approved" as const,
    reviewedById: reviewerId,
    reviewNote: note ?? null,
  };

  if (p.kind === "create") {
    const data = p.proposed as unknown as TxProposed;
    // Atomic: claim the pending, create the ledger row, link it, and flip any
    // linked installment together. A crash mid-way must not leave a
    // committed Transaction behind a still-"pending" approval (which
    // could then be approved again → double-posted revenue).
    const created = await prisma.$transaction(async (tx) => {
      await claimPending(tx, pendingId, resolution);
      const row = await tx.transaction.create({
        data: {
          date: new Date(data.date),
          month: data.month,
          type: data.type,
          category: data.category,
          subItem: data.subItem,
          description: data.description ?? null,
          paymentMode: data.paymentMode,
          amount: data.amount,
          flow: data.flow,
          partyId: data.partyId ?? null,
          employeeId: data.employeeId ?? null,
          expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
          isHistorical: isHistoricalDate(data.date),
          createdById: p.submittedById,
        },
      });
      await tx.pendingApproval.update({
        where: { id: pendingId },
        data: { targetTxId: row.id },
      });
      // If this pending was raised from a Collection Plan installment,
      // flip the installment to 'received' + link to the new transaction.
      if (p.collectionInstallmentId) {
        await tx.collectionPlanInstallment.update({
          where: { id: p.collectionInstallmentId },
          data: {
            status: "received",
            transactionId: row.id,
            pendingApprovalId: null,
          },
        });
      }
      return row;
    });
    await recordAudit({
      entityType: "Transaction",
      entityId: created.id,
      action: "APPROVE_CREATE",
      userId: reviewerId,
      changes: { pendingId, ...data, note: note ?? null },
    });
    return { applied: true as const, transactionId: created.id };
  }

  if (p.kind === "update" && p.targetTxId) {
    const data = p.proposed as unknown as TxProposed;
    const targetTxId = p.targetTxId;
    const before = await prisma.transaction.findUnique({ where: { id: targetTxId } });
    if (!before || before.deletedAt) return { error: "target_gone" as const };
    // Atomic: claim the pending and apply the edit together. An invoice
    // issued since the edit was submitted refuses it, rolling the claim back
    // so the pending stays open (reject it instead).
    const after = await prisma.$transaction(async (tx) => {
      await claimPending(tx, pendingId, resolution);
      await guardLedgerWrite(tx, targetTxId, data);
      const updated = await tx.transaction.update({
        where: { id: targetTxId },
        data: {
          date: new Date(data.date),
          month: data.month,
          type: data.type,
          category: data.category,
          subItem: data.subItem,
          description: data.description ?? null,
          paymentMode: data.paymentMode,
          amount: data.amount,
          flow: data.flow,
          partyId: data.partyId ?? null,
          employeeId: data.employeeId ?? null,
          expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
          isHistorical: isHistoricalDate(data.date),
        },
      });
      return updated;
    }).catch(invoicedOrThrow);
    if (after === INVOICED) return { error: "invoiced" as const };
    await recordAudit({
      entityType: "Transaction",
      entityId: after.id,
      action: "APPROVE_UPDATE",
      userId: reviewerId,
      changes: {
        pendingId,
        before: txSnapshot(before),
        after: data,
        note: note ?? null,
      },
    });
    return { applied: true as const, transactionId: after.id };
  }

  if (p.kind === "delete" && p.targetTxId) {
    const targetTxId = p.targetTxId;
    const before = await prisma.transaction.findUnique({ where: { id: targetTxId } });
    if (!before || before.deletedAt) return { error: "target_gone" as const };
    // Atomic: claim the pending and soft-delete the row together (refused,
    // and the claim rolled back, while a live invoice stands on the row).
    const deleted = await prisma.$transaction(async (tx) => {
      await claimPending(tx, pendingId, resolution);
      await guardLedgerWrite(tx, targetTxId, null);
      await tx.transaction.update({
        where: { id: targetTxId },
        data: { deletedAt: new Date(), deletedById: reviewerId },
      });
    }).catch(invoicedOrThrow);
    if (deleted === INVOICED) return { error: "invoiced" as const };
    await recordAudit({
      entityType: "Transaction",
      entityId: targetTxId,
      action: "APPROVE_DELETE",
      userId: reviewerId,
      changes: { pendingId, before: txSnapshot(before), note: note ?? null },
    });
    return { applied: true as const, transactionId: targetTxId };
  }

  return { error: "invalid_kind" as const };
}

export async function rejectPending(opts: {
  pendingId: string;
  reviewerId: string;
  reviewerPerms: Permissions;
  note?: string;
}) {
  const { pendingId, reviewerId, reviewerPerms, note } = opts;
  if (!canApprove(reviewerPerms)) return { error: "forbidden" as const };

  const p = await prisma.pendingApproval.findUnique({ where: { id: pendingId } });
  if (!p) return { error: "not_found" as const };
  if (p.status !== "pending") return { error: "already_resolved" as const };

  // Atomic: mark the pending rejected (only if nobody resolved it meanwhile)
  // and revert any linked installment together, so a crash can't leave a
  // rejected approval still owning a 'pending'-status installment (or vice
  // versa), and a reject racing an approve can't undo posted revenue's link.
  try {
    await prisma.$transaction(async (tx) => {
      await claimPending(tx, pendingId, {
        status: "rejected",
        reviewedById: reviewerId,
        reviewNote: note ?? null,
      });
      // Revert any linked installment back to 'pending' so the executive
      // can edit + resubmit it from the Collection Plan detail page.
      if (p.collectionInstallmentId) {
        await tx.collectionPlanInstallment.update({
          where: { id: p.collectionInstallmentId },
          data: { status: "pending", pendingApprovalId: null },
        });
      }
    });
  } catch (e) {
    if (e instanceof PendingAlreadyResolved) return { error: "already_resolved" as const };
    throw e;
  }
  await recordAudit({
    entityType: "PendingApproval",
    entityId: pendingId,
    action: "REJECT",
    userId: reviewerId,
    changes: { kind: p.kind, targetTxId: p.targetTxId, note: note ?? null },
  });
  return { rejected: true as const };
}

function txSnapshot(t: {
  date: Date;
  month: string;
  type: string;
  category: string;
  subItem: string;
  description: string | null;
  paymentMode: string;
  amount: { toString(): string };
  flow: string;
  partyId?: string | null;
  employeeId?: string | null;
  expDom?: string | null;
}) {
  return {
    date: t.date.toISOString(),
    month: t.month,
    type: t.type,
    category: t.category,
    subItem: t.subItem,
    description: t.description,
    paymentMode: t.paymentMode,
    amount: Number(t.amount.toString()),
    flow: t.flow,
    // Counterparty + EXP/DOM belong in the audit snapshot too, so the
    // "before" state of an update/delete records who the row was with
    // and its GST classification.
    partyId: t.partyId ?? null,
    employeeId: t.employeeId ?? null,
    expDom: t.expDom ?? null,
  };
}
