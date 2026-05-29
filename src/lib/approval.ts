import { prisma } from "./prisma";
import { recordAudit } from "./audit";
import { canApprove, needsApproval, type Permissions } from "./rbac";

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
        expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
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
  if (draft.submittedById !== userId && !perms.isAdmin) return { error: "forbidden" as const };
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
  if (draft.submittedById !== userId && !perms.isAdmin) return { error: "forbidden" as const };
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
  // who push on Ganga's behalf show up only in the audit log.
  if (draft.submittedById !== userId && !perms.isAdmin) return { error: "forbidden" as const };
  const ownerId = draft.submittedById;

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
          expDom: draft.type === "Revenue" ? (draft.expDom ?? null) : null,
          createdById: ownerId,
        },
      });
      await tx.transactionDraft.delete({ where: { id: draftId } });
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

  if (canApprove(perms)) {
    const updated = await prisma.transaction.update({
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
        expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
      },
    });
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

  if (canApprove(perms)) {
    await prisma.transaction.update({
      where: { id: txId },
      data: { deletedAt: new Date(), deletedById: userId },
    });
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

/** Manager/admin approves a pending change → applies it to the canonical Transaction table. */
export async function approvePending(opts: {
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

  if (p.kind === "create") {
    const data = p.proposed as unknown as TxProposed;
    // Atomic: create the ledger row, resolve the pending, and flip any
    // linked installment together. A crash mid-way must not leave a
    // committed Transaction behind a still-"pending" approval (which
    // could then be approved again → double-posted revenue).
    const created = await prisma.$transaction(async (tx) => {
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
          expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
          createdById: p.submittedById,
        },
      });
      await tx.pendingApproval.update({
        where: { id: pendingId },
        data: {
          status: "approved",
          reviewedById: reviewerId,
          reviewNote: note ?? null,
          reviewedAt: new Date(),
          targetTxId: row.id,
        },
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
    // Atomic: apply the edit and resolve the pending together.
    const after = await prisma.$transaction(async (tx) => {
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
          expDom: data.type === "Revenue" ? (data.expDom ?? null) : null,
        },
      });
      await tx.pendingApproval.update({
        where: { id: pendingId },
        data: {
          status: "approved",
          reviewedById: reviewerId,
          reviewNote: note ?? null,
          reviewedAt: new Date(),
        },
      });
      return updated;
    });
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
    // Atomic: soft-delete the row and resolve the pending together.
    await prisma.$transaction(async (tx) => {
      await tx.transaction.update({
        where: { id: targetTxId },
        data: { deletedAt: new Date(), deletedById: reviewerId },
      });
      await tx.pendingApproval.update({
        where: { id: pendingId },
        data: {
          status: "approved",
          reviewedById: reviewerId,
          reviewNote: note ?? null,
          reviewedAt: new Date(),
        },
      });
    });
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

  // Atomic: mark the pending rejected and revert any linked installment
  // together, so a crash can't leave a rejected approval still owning a
  // 'pending'-status installment (or vice versa).
  await prisma.$transaction(async (tx) => {
    await tx.pendingApproval.update({
      where: { id: pendingId },
      data: {
        status: "rejected",
        reviewedById: reviewerId,
        reviewNote: note ?? null,
        reviewedAt: new Date(),
      },
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
  };
}
