import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fromPrismaDate, todayIst, addDays, toPrismaDate } from "@/lib/lead-pulse-dates";
import { submitCreate } from "@/lib/approval";
import { buildValidatedProposed, type RawTxFields } from "@/lib/finance-tx-validation";
import { isHistoricalDate } from "@/lib/finance-historical";
import { gstInAmount } from "@/lib/finance-gst";
import { canApprove, needsApproval, type Permissions } from "@/lib/rbac";
import { badRequest, conflict, forbidden, notFound } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { logEvent } from "./events";
import { fromDecimal, toDecimalString } from "./money";
import {
  DAY_WINDOW,
  LEDGER_MODE,
  REF_DAY_WINDOW,
  SUGGEST_SCORE,
  TRANSFER_DAY_WINDOW,
  autoMatchFor,
  autoTransferFor,
  isTestCredit,
  narrationSignature,
  primaryReference,
  rankLedger,
  rankTransfers,
  referencesOf,
  suggestBooking,
  tokensOf,
  type BankLine,
  type LedgerEntry,
  type PastBooking,
} from "./reconcile";

/**
 * The reconciliation engine against the database: it runs after every
 * statement import and on "Match now".
 *
 * It only ever touches a line no person has touched: UNMATCHED, never
 * reconciled by anyone (`reconciledById` null), no ledger link. A line a
 * person unmatched or unpaired stays as they left it. Every write claims its
 * line by that state inside a transaction, and locks are always taken in the
 * same order — the bank line first, then the ledger entry — so a line is
 * never matched twice and a ledger entry never beyond its amount.
 */

/** Lines are revisited this far back on each run. */
const LOOKBACK_DAYS = 120;
const TX_OPTS = { timeout: 20_000, maxWait: 10_000 };

/** A line the engine may decide. */
const ENGINE_OPEN = { reconciliationStatus: "UNMATCHED", reconciledById: null, matches: { none: {} } } satisfies Prisma.BankTransactionWhereInput;
/** A line a person may still decide. */
const PERSON_OPEN = { reconciliationStatus: { in: ["UNMATCHED", "MANUAL_REVIEW"] }, matches: { none: {} } } satisfies Prisma.BankTransactionWhereInput;

const LINE_SELECT = {
  id: true,
  integrationId: true,
  direction: true,
  debitAmount: true,
  creditAmount: true,
  txnDate: true,
  description: true,
  referenceNumber: true,
  upiReference: true,
  bankReference: true,
  reconciliationStatus: true,
  integration: { select: { bankCode: true, accountLastFour: true, bankName: true } },
} satisfies Prisma.BankTransactionSelect;

type LineRow = Prisma.BankTransactionGetPayload<{ select: typeof LINE_SELECT }>;

export function lineOf(r: LineRow): BankLine {
  const direction = r.direction === "DEBIT" ? "DEBIT" : "CREDIT";
  return {
    id: r.id,
    integrationId: r.integrationId,
    bankCode: r.integration.bankCode.toUpperCase(),
    accountLastFour: r.integration.accountLastFour,
    direction,
    amount: fromDecimal(direction === "DEBIT" ? r.debitAmount : r.creditAmount) ?? 0,
    txnDate: fromPrismaDate(r.txnDate),
    description: r.description,
    references: referencesOf(r),
  };
}

/** Ledger entries dated in [from, to] with what is already tied to bank lines; descriptions tokenised once. */
async function ledgerBetween(from: string, to: string): Promise<LedgerEntry[]> {
  const rows = await prisma.transaction.findMany({
    where: { deletedAt: null, isHistorical: false, date: { gte: toPrismaDate(from), lt: toPrismaDate(addDays(to, 1)) } },
    select: {
      id: true,
      date: true,
      type: true,
      amount: true,
      description: true,
      paymentMode: true,
      party: { select: { name: true } },
      employee: { select: { name: true } },
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take: 50_000,
  });
  const sums = rows.length
    ? await prisma.bankTransactionMatch.groupBy({ by: ["transactionId"], where: { transactionId: { in: rows.map((r) => r.id) } }, _sum: { amount: true } })
    : [];
  const matched = new Map(sums.map((s) => [s.transactionId, fromDecimal(s._sum.amount) ?? 0]));
  return rows
    .filter((r) => r.type === "Revenue" || r.type === "Expense")
    .map((r) => ({
      id: r.id,
      date: r.date.toISOString().slice(0, 10),
      type: r.type as "Revenue" | "Expense",
      amount: fromDecimal(r.amount) ?? 0,
      matched: matched.get(r.id) ?? 0,
      description: r.description,
      refs: new Set(tokensOf(r.description)),
      counterparty: r.party?.name ?? r.employee?.name ?? null,
      paymentMode: r.paymentMode,
    }));
}

/**
 * A ledger entry's amount and what is tied to bank lines, under a row lock on
 * the entry. `except` leaves one bank line's own links out (it is about to
 * replace them). Null when the entry is gone.
 */
async function lockedEntry(tx: Prisma.TransactionClient, transactionId: string, except?: string): Promise<{ amount: number; matched: number } | null> {
  const rows = await tx.$queryRaw<{ amount: string }[]>`SELECT amount::text AS amount FROM "Transaction" WHERE id = ${transactionId} AND "deletedAt" IS NULL FOR UPDATE`;
  if (!rows.length) return null;
  const agg = await tx.bankTransactionMatch.aggregate({
    where: { transactionId, ...(except ? { bankTransactionId: { not: except } } : {}) },
    _sum: { amount: true },
  });
  return { amount: fromDecimal(rows[0].amount) ?? 0, matched: fromDecimal(agg._sum.amount) ?? 0 };
}

/** Lock a bank line for the rest of the transaction and read its state. */
async function lockedLine(tx: Prisma.TransactionClient, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "BankTransaction" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) return null;
  return tx.bankTransaction.findUnique({
    where: { id },
    select: { ...LINE_SELECT, reconciledById: true, transferPairId: true, pendingEntryRef: true, _count: { select: { matches: true } } },
  });
}

/** True when no other bank line, anywhere, carries this reference (a re-sent or duplicate payment would). */
async function onlyLineWith(ref: string, lineId: string): Promise<boolean> {
  const n = await prisma.bankTransaction.count({
    where: {
      id: { not: lineId },
      OR: [{ upiReference: ref }, { bankReference: ref }, { referenceNumber: { endsWith: ref } }, { description: { contains: ref, mode: "insensitive" } }],
    },
  });
  return n === 0;
}

class Rollback extends Error {}

export type AutoResult = { examined: number; matched: number; transfers: number };

/**
 * Match what can be matched without a person: a payment reference that one
 * bank line and one ledger entry carry, with exactly the entry's open amount;
 * and transfers between DesGro's accounts whose two legs carry the same
 * reference (and only each other).
 */
export async function autoReconcile(opts: { integrationId?: string | null; sinceDays?: number } = {}): Promise<AutoResult> {
  const since = addDays(todayIst(), -(opts.sinceDays ?? LOOKBACK_DAYS));
  // Newest first, so the lines just imported are never the ones cut off.
  const rows = await prisma.bankTransaction.findMany({
    where: { ...ENGINE_OPEN, txnDate: { gte: toPrismaDate(since) }, ...(opts.integrationId ? { integrationId: opts.integrationId } : {}) },
    select: LINE_SELECT,
    orderBy: [{ txnDate: "desc" }, { rowIndex: "desc" }],
    take: 5000,
  });
  if (!rows.length) return { examined: 0, matched: 0, transfers: 0 };
  const lines = rows.map(lineOf).reverse();
  const dates = lines.map((l) => l.txnDate).sort();
  const ledger = await ledgerBetween(addDays(dates[0], -REF_DAY_WINDOW), addDays(dates[dates.length - 1], REF_DAY_WINDOW));
  // Entries by payment id: a line is only ever scored against entries sharing one.
  const byRef = new Map<string, LedgerEntry[]>();
  for (const l of ledger) for (const r of l.refs ?? []) byRef.set(r, [...(byRef.get(r) ?? []), l]);
  // A reference two unmatched lines share is a duplicate or a re-send: a person decides.
  const refCount = new Map<string, number>();
  for (const line of lines) for (const r of line.references) refCount.set(r, (refCount.get(r) ?? 0) + 1);

  let matched = 0;
  const done = new Set<string>();
  for (const line of lines) {
    if (!line.references.length) continue;
    const pool = Array.from(new Set(line.references.flatMap((r) => byRef.get(r) ?? [])));
    const pick = autoMatchFor(line, rankLedger(line, pool));
    if (!pick) continue;
    const ref = line.references.find((r) => pool.find((p) => p.id === pick.id)?.refs?.has(r));
    if (!ref || (refCount.get(ref) ?? 0) > 1 || !(await onlyLineWith(ref, line.id))) continue;
    const ok = await prisma
      .$transaction(async (tx) => {
        // The bank line first (its row lock), then the ledger entry.
        const claimed = await tx.bankTransaction.updateMany({
          where: { id: line.id, ...ENGINE_OPEN },
          data: {
            reconciliationStatus: "MATCHED",
            autoMatched: true,
            pendingEntryRef: null,
            reconciliationNote: `Matched automatically: reference ${ref} and the exact amount`,
            reconciledAt: new Date(),
          },
        });
        if (!claimed.count) throw new Rollback();
        const cur = await lockedEntry(tx, pick.id);
        if (!cur || cur.amount - cur.matched !== line.amount) throw new Rollback();
        await tx.bankTransactionMatch.create({
          data: { bankTransactionId: line.id, transactionId: pick.id, amount: toDecimalString(line.amount), note: "auto: reference + amount" },
        });
        return true;
      }, TX_OPTS)
      .catch((e) => {
        if (e instanceof Rollback) return false;
        throw e;
      });
    if (ok) {
      matched++;
      done.add(line.id);
      const l = ledger.find((x) => x.id === pick.id);
      if (l) l.matched += line.amount;
    }
  }

  // Transfers between DesGro's own accounts: the same reference on both legs,
  // and each leg the only such candidate for the other.
  let transfers = 0;
  const open = () => lines.filter((l) => !done.has(l.id));
  for (const a of lines.filter((l) => l.direction === "DEBIT")) {
    if (done.has(a.id)) continue;
    const pick = autoTransferFor(rankTransfers(a, open()));
    if (!pick) continue;
    const b = lines.find((l) => l.id === pick.id)!;
    const back = autoTransferFor(rankTransfers(b, open()));
    if (back?.id !== a.id) continue;
    if (await claimTransfer(a.id, b.id, null, "Paired automatically: same reference on both accounts")) {
      transfers++;
      done.add(a.id);
      done.add(b.id);
    }
  }
  return { examined: lines.length, matched, transfers };
}

/**
 * Mark two lines as the legs of one transfer, or neither. The engine may only
 * claim lines no person touched; a person may also pair lines set to review.
 * Locks are taken in id order, so two pairings can't deadlock.
 */
async function claimTransfer(aId: string, bId: string, userId: string | null, note: string): Promise<boolean> {
  const open = userId === null ? ENGINE_OPEN : PERSON_OPEN;
  const pairs: Array<[string, string]> = [
    [aId, bId],
    [bId, aId],
  ];
  pairs.sort((x, y) => x[0].localeCompare(y[0]));
  return prisma
    .$transaction(async (tx) => {
      const now = new Date();
      for (const [me, other] of pairs) {
        const c = await tx.bankTransaction.updateMany({
          where: { id: me, ...open },
          data: { reconciliationStatus: "TRANSFER", transferPairId: other, autoMatched: userId === null, pendingEntryRef: null, reconciliationNote: note, reconciledById: userId, reconciledAt: now },
        });
        if (!c.count) throw new Rollback();
      }
      return true;
    }, TX_OPTS)
    .catch((e) => {
      if (e instanceof Rollback) return false;
      throw e;
    });
}

/** A person pairs two lines as one transfer between DesGro's accounts. */
export async function pairTransfer(aId: string, bId: string, userId: string) {
  const [a, b] = await Promise.all([
    prisma.bankTransaction.findUnique({ where: { id: aId }, select: LINE_SELECT }),
    prisma.bankTransaction.findUnique({ where: { id: bId }, select: LINE_SELECT }),
  ]);
  if (!a || !b) throw notFound("Bank transaction not found");
  const la = lineOf(a);
  const lb = lineOf(b);
  if (la.integrationId === lb.integrationId) throw badRequest("A transfer is between two different DesGro accounts");
  if (la.direction === lb.direction || la.amount !== lb.amount) throw badRequest("A transfer leaves one account and arrives in the other with the same amount");
  const ok = await claimTransfer(aId, bId, userId, `Transfer between ${a.integration.bankName} ••${la.accountLastFour} and ${b.integration.bankName} ••${lb.accountLastFour}`);
  if (!ok) throw conflict("One of these lines was reconciled in the meantime — reload and try again", "recon_stale");
  await recordAudit({ entityType: "BankTransaction", entityId: aId, action: "UPDATE", userId, changes: { reconciliation: "TRANSFER", transferPairId: bId } });
  await logEvent({ integrationId: la.integrationId, step: "reconcile", message: `Transactions ${aId} and ${bId} paired as a transfer`, userId });
}

/** Undo a transfer pairing: both legs go back to unmatched — and the engine leaves them so. */
export async function unpairTransfer(id: string, userId: string) {
  const line = await prisma.bankTransaction.findUnique({ where: { id }, select: { id: true, integrationId: true, transferPairId: true, reconciliationStatus: true } });
  if (!line) throw notFound("Bank transaction not found");
  if (line.reconciliationStatus !== "TRANSFER") throw badRequest("This line is not a transfer");
  const ids = [line.id, ...(line.transferPairId ? [line.transferPairId] : [])];
  await prisma.bankTransaction.updateMany({
    where: { id: { in: ids }, reconciliationStatus: "TRANSFER" },
    data: { reconciliationStatus: "UNMATCHED", transferPairId: null, autoMatched: false, reconciliationNote: "Transfer pairing undone", reconciledById: userId, reconciledAt: new Date() },
  });
  await recordAudit({ entityType: "BankTransaction", entityId: id, action: "UPDATE", userId, changes: { reconciliation: "UNMATCHED", unpaired: ids } });
}

/** Set aside every unmatched ₹1–₹10 test credit at once. */
export async function ignoreTestCredits(userId: string, integrationId?: string | null): Promise<number> {
  const rows = await prisma.bankTransaction.findMany({
    where: { reconciliationStatus: "UNMATCHED", matches: { none: {} }, direction: "CREDIT", creditAmount: { gt: 0, lte: 10 }, ...(integrationId ? { integrationId } : {}) },
    select: { id: true, direction: true, creditAmount: true },
  });
  const ids = rows.filter((r) => isTestCredit({ direction: r.direction, amount: fromDecimal(r.creditAmount) ?? 0 })).map((r) => r.id);
  if (!ids.length) return 0;
  const { count } = await prisma.bankTransaction.updateMany({
    where: { id: { in: ids }, reconciliationStatus: "UNMATCHED", matches: { none: {} } },
    data: { reconciliationStatus: "IGNORED", reconciliationNote: "Test credit", reconciledById: userId, reconciledAt: new Date() },
  });
  await recordAudit({ entityType: "BankTransaction", entityId: ids[0], action: "UPDATE", userId, changes: { reconciliation: "IGNORED", testCredits: ids } });
  return count;
}

/** Earlier lines of the same shape that were booked to exactly one ledger entry. */
async function pastBookings(integrationId: string, direction: string): Promise<PastBooking[]> {
  const rows = await prisma.bankTransaction.findMany({
    where: { integrationId, direction, reconciliationStatus: "MATCHED" },
    select: {
      description: true,
      matches: { select: { transaction: { select: { type: true, category: true, subItem: true, partyId: true, employeeId: true, amount: true, date: true, deletedAt: true } } } },
    },
    orderBy: { txnDate: "desc" },
    take: 500,
  });
  return rows
    .filter((r) => r.matches.length === 1 && !r.matches[0].transaction.deletedAt)
    .map((r) => {
      const t = r.matches[0].transaction;
      return {
        signature: narrationSignature(r.description),
        amount: fromDecimal(t.amount) ?? 0,
        type: t.type,
        category: t.category,
        subItem: t.subItem,
        partyId: t.partyId,
        employeeId: t.employeeId,
        date: t.date.toISOString().slice(0, 10),
      };
    });
}

export type LineSuggestions = {
  /** Amounts in rupees, like everything else this returns. */
  line: Omit<BankLine, "amount"> & { amount: number; bankName: string };
  ledger: Array<{
    id: string;
    date: string;
    type: string;
    category: string;
    description: string | null;
    paymentMode: string;
    counterparty: string | null;
    amount: number;
    open: number;
    score: number;
    reasons: string[];
  }>;
  transfers: Array<{ id: string; account: string; date: string; description: string; amount: number; score: number; reasons: string[] }>;
  booking: (Omit<PastBooking, "signature" | "amount" | "date"> & { paymentMode: string }) | null;
  testCredit: boolean;
};

/** What the Reconcile dialog offers for one line: ledger suggestions, a transfer leg, a booking. */
export async function lineSuggestions(id: string): Promise<LineSuggestions> {
  const row = await prisma.bankTransaction.findUnique({ where: { id }, select: LINE_SELECT });
  if (!row) throw notFound("Bank transaction not found");
  const line = lineOf(row);
  const ledger = await ledgerBetween(addDays(line.txnDate, -REF_DAY_WINDOW), addDays(line.txnDate, REF_DAY_WINDOW));
  // This line's own links don't count against an entry's open amount here.
  const own = await prisma.bankTransactionMatch.findMany({ where: { bankTransactionId: id }, select: { transactionId: true, amount: true } });
  for (const m of own) {
    const l = ledger.find((x) => x.id === m.transactionId);
    if (l) l.matched -= fromDecimal(m.amount) ?? 0;
  }
  const ranked = rankLedger(line, ledger).filter((s) => s.score >= SUGGEST_SCORE).slice(0, 10);
  const details = ranked.length
    ? await prisma.transaction.findMany({
        where: { id: { in: ranked.map((s) => s.id) }, isHistorical: false },
        select: { id: true, date: true, type: true, category: true, subItem: true, description: true, paymentMode: true, amount: true, party: { select: { name: true } }, employee: { select: { name: true } } },
      })
    : [];
  const d = new Map(details.map((t) => [t.id, t]));

  const others = await prisma.bankTransaction.findMany({
    where: {
      integrationId: { not: line.integrationId },
      ...PERSON_OPEN,
      direction: line.direction === "DEBIT" ? "CREDIT" : "DEBIT",
      txnDate: { gte: toPrismaDate(addDays(line.txnDate, -TRANSFER_DAY_WINDOW)), lte: toPrismaDate(addDays(line.txnDate, TRANSFER_DAY_WINDOW)) },
    },
    select: LINE_SELECT,
    take: 200,
  });
  const otherById = new Map(others.map((o) => [o.id, o]));
  const transfers = rankTransfers(line, others.map(lineOf)).slice(0, 3);

  const booking = suggestBooking(line, await pastBookings(line.integrationId, line.direction));
  return {
    line: { ...line, amount: line.amount / 100, bankName: row.integration.bankName },
    ledger: ranked
      .filter((s) => d.has(s.id))
      .map((s) => {
        const t = d.get(s.id)!;
        return {
          id: s.id,
          date: t.date.toISOString().slice(0, 10),
          type: t.type,
          category: `${t.category} · ${t.subItem}`,
          description: t.description,
          paymentMode: t.paymentMode,
          counterparty: t.party?.name ?? t.employee?.name ?? null,
          amount: (fromDecimal(t.amount) ?? 0) / 100,
          open: s.open / 100,
          score: s.score,
          reasons: s.reasons,
        };
      }),
    transfers: transfers.map((s) => {
      const o = otherById.get(s.id)!;
      return {
        id: s.id,
        account: `${o.integration.bankName} ••${o.integration.accountLastFour}`,
        date: fromPrismaDate(o.txnDate),
        description: o.description,
        amount: line.amount / 100,
        score: s.score,
        reasons: s.reasons,
      };
    }),
    booking: booking
      ? { type: booking.type, category: booking.category, subItem: booking.subItem, partyId: booking.partyId, employeeId: booking.employeeId, paymentMode: LEDGER_MODE[line.bankCode] ?? row.integration.bankName }
      : null,
    testCredit: isTestCredit(line),
  };
}

export type CreateEntryResult = { outcome: "matched" | "pending" | "draft"; transactionId?: string; pendingId?: string; draftId?: string };

/** An entry created from this line earlier, still waiting in drafts or for approval. */
async function stillWaiting(ref: string | null): Promise<boolean> {
  if (!ref) return false;
  const [draft, pending] = await Promise.all([
    prisma.transactionDraft.count({ where: { id: ref } }),
    prisma.pendingApproval.count({ where: { id: ref, status: "pending" } }),
  ]);
  return draft + pending > 0;
}

/**
 * "Create entry from this line": a ledger entry for a bank line that has none
 * yet (EPFO, ESIC, TDS, salaries, bank charges, a loan EMI). The date, amount
 * and bank come from the line; Finance picks what it is; the Daily Tracker's
 * validation applies.
 *
 * Posted directly (an approver), the entry and its match are written in ONE
 * transaction under a lock on the line, so a line taken in the meantime means
 * no entry at all — never an entry with no bank line. Otherwise it goes to
 * drafts / approval like any entry, the line remembers it (no second one while
 * it waits), and once approved the engine matches it by the reference written
 * into its description.
 */
export async function createEntryFromLine(
  id: string,
  input: Pick<RawTxFields, "category" | "subItem" | "description" | "partyId" | "employeeId" | "expDom">,
  userId: string,
  perms: Permissions,
): Promise<CreateEntryResult> {
  const row = await prisma.bankTransaction.findUnique({
    where: { id },
    select: { ...LINE_SELECT, pendingEntryRef: true, transferPairId: true, _count: { select: { matches: true } } },
  });
  if (!row) throw notFound("Bank transaction not found");
  if (!["UNMATCHED", "MANUAL_REVIEW"].includes(row.reconciliationStatus) || row._count.matches) throw conflict("This line is already reconciled", "recon_stale");
  if (await stillWaiting(row.pendingEntryRef)) throw conflict("An entry for this line is already waiting in drafts or for approval", "entry_waiting");
  const line = lineOf(row);
  if (isHistoricalDate(line.txnDate)) throw badRequest("This line is from before DesGro's ledger began — record it as a historical payment instead");
  const mode = LEDGER_MODE[line.bankCode];
  if (!mode) throw badRequest(`No ledger payment mode for ${row.integration.bankName}`);
  const ref = primaryReference(row);
  const description = [input.description?.trim(), ref && !(input.description ?? "").toUpperCase().includes(ref) ? `Ref ${ref}` : null]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 500);
  const built = await buildValidatedProposed({
    date: line.txnDate,
    type: line.direction === "CREDIT" ? "Revenue" : "Expense",
    category: input.category,
    subItem: input.subItem,
    description: description || row.description.slice(0, 500),
    paymentMode: mode,
    amount: line.amount / 100,
    flow: line.direction === "CREDIT" ? "Inflow" : "Outflow",
    partyId: input.partyId ?? null,
    employeeId: input.employeeId ?? null,
    expDom: line.direction === "CREDIT" ? (input.expDom ?? null) : null,
  });
  if ("error" in built) throw badRequest(`The entry is not valid: ${built.error}`, built.error);
  const data = built.proposed;

  if (!perms.draftFirst && canApprove(perms)) {
    const created = await prisma
      .$transaction(async (tx) => {
        const l = await lockedLine(tx, id);
        if (!l || !["UNMATCHED", "MANUAL_REVIEW"].includes(l.reconciliationStatus) || l._count.matches || l.transferPairId) throw new Rollback();
        const t = await tx.transaction.create({
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
            gstAmount: gstInAmount({ ...data, expDom: data.type === "Revenue" ? (data.expDom ?? null) : null }),
            isHistorical: false,
            createdById: userId,
          },
        });
        await tx.bankTransactionMatch.create({ data: { bankTransactionId: id, transactionId: t.id, amount: toDecimalString(line.amount), createdById: userId, note: "created from the bank line" } });
        await tx.bankTransaction.update({
          where: { id },
          data: { reconciliationStatus: "MATCHED", autoMatched: false, pendingEntryRef: null, reconciliationNote: "Ledger entry created from this line", reconciledById: userId, reconciledAt: new Date() },
        });
        return t;
      }, TX_OPTS)
      .catch((e) => {
        if (e instanceof Rollback) throw conflict("This line was reconciled in the meantime — nothing was created", "recon_stale");
        throw e;
      });
    await recordAudit({ entityType: "Transaction", entityId: created.id, action: "CREATE", userId, changes: { ...data, fromBankLine: id } });
    await recordAudit({ entityType: "BankTransaction", entityId: id, action: "UPDATE", userId, changes: { createdEntry: created.id } });
    return { outcome: "matched", transactionId: created.id };
  }

  if (!perms.draftFirst && !needsApproval(perms)) throw forbidden("Your role can't post ledger entries");
  const result = await submitCreate({ data, userId, perms });
  if (result.applied) {
    // Not reached (approvers are handled above); keep the line honest if it ever is.
    return { outcome: "matched", transactionId: result.transaction.id };
  }
  const waiting = "isDraft" in result && result.isDraft ? result.draft.id : "pending" in result ? result.pending.id : null;
  const note = "isDraft" in result && result.isDraft ? "Entry saved to drafts from this line — submit it; it is matched once posted" : "Entry sent for approval from this line — it is matched once approved";
  // Stays UNMATCHED and untouched by a person, so the engine matches the entry once it is posted.
  await prisma.bankTransaction.updateMany({ where: { id, ...PERSON_OPEN }, data: { pendingEntryRef: waiting, reconciliationNote: note } });
  await recordAudit({ entityType: "BankTransaction", entityId: id, action: "UPDATE", userId, changes: { entryWaiting: waiting } });
  if ("isDraft" in result && result.isDraft) return { outcome: "draft", draftId: result.draft.id };
  return { outcome: "pending", pendingId: waiting ?? undefined };
}

/**
 * A person's match for one bank line, replacing its links — atomically: the
 * line is locked first, then each picked ledger entry (in id order), and the
 * checks run under those locks, so neither the engine nor another person can
 * slip a second match in between.
 */
export async function setLineMatches(
  id: string,
  body: { matches?: Array<{ transactionId: string; amount: number }>; status?: "UNMATCHED" | "IGNORED" | "MANUAL_REVIEW"; note?: string | null },
  userId: string,
): Promise<{ status: string; integrationId: string }> {
  return prisma.$transaction(async (tx) => {
    const l = await lockedLine(tx, id);
    if (!l) throw notFound("Bank transaction not found");
    if (l.reconciliationStatus === "TRANSFER") throw badRequest("This line is a transfer between DesGro's accounts — unpair it first");
    const amount = fromDecimal(l.direction === "DEBIT" ? l.debitAmount : l.creditAmount) ?? 0;
    const now = new Date();
    const reset = { autoMatched: false, transferPairId: null, pendingEntryRef: null, reconciliationNote: body.note ?? null, reconciledById: userId, reconciledAt: now };
    if (body.matches !== undefined) {
      const picks = [...body.matches].sort((a, b) => a.transactionId.localeCompare(b.transactionId));
      if (new Set(picks.map((m) => m.transactionId)).size !== picks.length) throw badRequest("A ledger transaction can be matched once");
      const total = picks.reduce((s, m) => s + Math.round(m.amount * 100), 0);
      if (total > amount) throw badRequest("Matched amounts exceed the bank amount");
      for (const m of picks) {
        const e = await lockedEntry(tx, m.transactionId, id);
        if (!e) throw badRequest("One of the ledger transactions no longer exists");
        // A ledger entry paid in parts can be tied to several bank lines, never for more than its amount.
        if (e.matched + Math.round(m.amount * 100) > e.amount) {
          throw badRequest("That ledger entry is already matched to other bank lines for most of its amount — match only what is still open");
        }
      }
      const status = body.status ?? (total <= 0 ? "UNMATCHED" : total >= amount ? "MATCHED" : "PARTIALLY_MATCHED");
      await tx.bankTransactionMatch.deleteMany({ where: { bankTransactionId: id } });
      if (picks.length) {
        await tx.bankTransactionMatch.createMany({
          data: picks.map((m) => ({ bankTransactionId: id, transactionId: m.transactionId, amount: m.amount.toFixed(2), note: body.note ?? null, createdById: userId })),
        });
      }
      await tx.bankTransaction.update({ where: { id }, data: { reconciliationStatus: status, ...reset } });
      return { status, integrationId: l.integrationId };
    }
    if (!body.status) throw badRequest("Provide matches or a status");
    await tx.bankTransaction.update({ where: { id }, data: { reconciliationStatus: body.status, ...reset } });
    return { status: body.status, integrationId: l.integrationId };
  }, TX_OPTS);
}

export type MonthStatus = {
  integrationId: string;
  account: string;
  month: string; // YYYY-MM
  lines: number;
  explained: number;
  open: number;
  closingBalance: number | null;
  done: boolean;
};

const EXPLAINED = new Set(["MATCHED", "IGNORED", "TRANSFER"]);

function monthsBack(today: string, n: number): string {
  let [y, m] = today.slice(0, 7).split("-").map(Number);
  m -= n - 1;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * Each account's months: how many lines are explained (matched in full, set
 * aside, or a transfer) and the bank's closing balance. A month is done when
 * every line is explained — then the ledger accounts for every rupee that
 * moved, and the closing balance is the books' balance for the account. A
 * line matched only to entries since deleted is not explained.
 */
export async function monthStatuses(months = 6): Promise<MonthStatus[]> {
  const since = monthsBack(todayIst(), months);
  const [grouped, orphaned, accounts] = await Promise.all([
    prisma.bankTransaction.groupBy({
      by: ["integrationId", "reconciliationStatus", "txnDate"],
      where: { txnDate: { gte: toPrismaDate(since) } },
      _count: { _all: true },
    }),
    prisma.bankTransaction.findMany({
      where: { txnDate: { gte: toPrismaDate(since) }, reconciliationStatus: "MATCHED", matches: { every: { transaction: { deletedAt: { not: null } } } } },
      select: { integrationId: true, txnDate: true },
    }),
    prisma.bankIntegration.findMany({ select: { id: true, bankName: true, accountLastFour: true } }),
  ]);
  const name = new Map(accounts.map((a) => [a.id, `${a.bankName} ••${a.accountLastFour}`]));
  const acc = new Map<string, MonthStatus>();
  for (const g of grouped) {
    const month = fromPrismaDate(g.txnDate).slice(0, 7);
    const key = `${g.integrationId}|${month}`;
    const m = acc.get(key) ?? { integrationId: g.integrationId, account: name.get(g.integrationId) ?? "Account", month, lines: 0, explained: 0, open: 0, closingBalance: null, done: false };
    m.lines += g._count._all;
    if (EXPLAINED.has(g.reconciliationStatus)) m.explained += g._count._all;
    acc.set(key, m);
  }
  for (const o of orphaned) {
    const m = acc.get(`${o.integrationId}|${fromPrismaDate(o.txnDate).slice(0, 7)}`);
    if (m) m.explained -= 1;
  }
  const out = Array.from(acc.values());
  await Promise.all(
    out.map(async (m) => {
      const last = await prisma.bankTransaction.findFirst({
        where: { integrationId: m.integrationId, txnDate: { gte: toPrismaDate(`${m.month}-01`), lt: toPrismaDate(nextMonth(m.month)) }, runningBalance: { not: null } },
        orderBy: [{ txnDate: "desc" }, { statement: { periodStart: "desc" } }, { rowIndex: "desc" }],
        select: { runningBalance: true },
      });
      m.closingBalance = last?.runningBalance ? (fromDecimal(last.runningBalance) ?? 0) / 100 : null;
      m.open = m.lines - m.explained;
      m.done = m.open === 0;
    }),
  );
  return out.sort((a, b) => b.month.localeCompare(a.month) || a.account.localeCompare(b.account));
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export { DAY_WINDOW };
