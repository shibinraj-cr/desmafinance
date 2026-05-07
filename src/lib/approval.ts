import { prisma } from "./prisma";
import { recordAudit } from "./audit";
import { canApprove, needsApproval } from "./rbac";

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
};

/**
 * For admin/manager: create the transaction directly.
 * For executive: enqueue a PendingApproval.create record.
 *
 * Returns { applied: true, transaction } when written to the canonical table,
 * or { applied: false, pending } when queued.
 */
export async function submitCreate(opts: {
  data: TxProposed;
  userId: string;
  role: string;
}) {
  const { data, userId, role } = opts;
  if (canApprove(role)) {
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

  if (!needsApproval(role)) throw new Error("unexpected role");
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

export async function submitUpdate(opts: {
  txId: string;
  data: TxProposed;
  userId: string;
  role: string;
}) {
  const { txId, data, userId, role } = opts;
  const existing = await prisma.transaction.findUnique({ where: { id: txId } });
  if (!existing || existing.deletedAt) {
    return { error: "not_found" as const };
  }

  if (canApprove(role)) {
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
  role: string;
}) {
  const { txId, userId, role } = opts;
  const existing = await prisma.transaction.findUnique({ where: { id: txId } });
  if (!existing || existing.deletedAt) {
    return { error: "not_found" as const };
  }

  if (canApprove(role)) {
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
  reviewerRole: string;
  note?: string;
}) {
  const { pendingId, reviewerId, reviewerRole, note } = opts;
  if (!canApprove(reviewerRole)) return { error: "forbidden" as const };

  const p = await prisma.pendingApproval.findUnique({ where: { id: pendingId } });
  if (!p) return { error: "not_found" as const };
  if (p.status !== "pending") return { error: "already_resolved" as const };

  if (p.kind === "create") {
    const data = p.proposed as unknown as TxProposed;
    const tx = await prisma.transaction.create({
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
        createdById: p.submittedById,
      },
    });
    await prisma.pendingApproval.update({
      where: { id: pendingId },
      data: {
        status: "approved",
        reviewedById: reviewerId,
        reviewNote: note ?? null,
        reviewedAt: new Date(),
        targetTxId: tx.id,
      },
    });
    await recordAudit({
      entityType: "Transaction",
      entityId: tx.id,
      action: "APPROVE_CREATE",
      userId: reviewerId,
      changes: { pendingId, ...data, note: note ?? null },
    });
    return { applied: true as const, transactionId: tx.id };
  }

  if (p.kind === "update" && p.targetTxId) {
    const data = p.proposed as unknown as TxProposed;
    const before = await prisma.transaction.findUnique({ where: { id: p.targetTxId } });
    if (!before || before.deletedAt) return { error: "target_gone" as const };
    const after = await prisma.transaction.update({
      where: { id: p.targetTxId },
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
      },
    });
    await prisma.pendingApproval.update({
      where: { id: pendingId },
      data: {
        status: "approved",
        reviewedById: reviewerId,
        reviewNote: note ?? null,
        reviewedAt: new Date(),
      },
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
    const before = await prisma.transaction.findUnique({ where: { id: p.targetTxId } });
    if (!before || before.deletedAt) return { error: "target_gone" as const };
    await prisma.transaction.update({
      where: { id: p.targetTxId },
      data: { deletedAt: new Date(), deletedById: reviewerId },
    });
    await prisma.pendingApproval.update({
      where: { id: pendingId },
      data: {
        status: "approved",
        reviewedById: reviewerId,
        reviewNote: note ?? null,
        reviewedAt: new Date(),
      },
    });
    await recordAudit({
      entityType: "Transaction",
      entityId: p.targetTxId,
      action: "APPROVE_DELETE",
      userId: reviewerId,
      changes: { pendingId, before: txSnapshot(before), note: note ?? null },
    });
    return { applied: true as const, transactionId: p.targetTxId };
  }

  return { error: "invalid_kind" as const };
}

export async function rejectPending(opts: {
  pendingId: string;
  reviewerId: string;
  reviewerRole: string;
  note?: string;
}) {
  const { pendingId, reviewerId, reviewerRole, note } = opts;
  if (!canApprove(reviewerRole)) return { error: "forbidden" as const };

  const p = await prisma.pendingApproval.findUnique({ where: { id: pendingId } });
  if (!p) return { error: "not_found" as const };
  if (p.status !== "pending") return { error: "already_resolved" as const };

  await prisma.pendingApproval.update({
    where: { id: pendingId },
    data: {
      status: "rejected",
      reviewedById: reviewerId,
      reviewNote: note ?? null,
      reviewedAt: new Date(),
    },
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
