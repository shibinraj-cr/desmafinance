import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fromPrismaDate, toPrismaDate, todayIst } from "@/lib/lead-pulse-dates";
import { canSeePage, type Permissions } from "@/lib/rbac";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "@/lib/http-error";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { fromDecimal, toDecimalString } from "@/lib/bank/money";
import {
  CASH_KIND_LABEL,
  CASH_MODE,
  DIRECTOR_CARD_MODE,
  allocateClaims,
  claimMonths,
  floatMonths,
  looksLikeCashWithdrawal,
  namesPayee,
  type CashFloatsData,
  type CashKind,
  type DirectorCardData,
  type OpenLine,
} from "./cash-floats";
import { parseVoucherSheet, voucherHashes } from "./cash-floats-vouchers";

export const CASH_PAGE = "/finance/cash-floats";
export const CARD_PAGE = "/finance/director-card";

/** Who may do what: the page grant to see; acting also needs a role that posts without approval. */
export type FloatCaps = { view: boolean; act: boolean };
export function floatCaps(p: Permissions | null | undefined, page: string): FloatCaps {
  if (!p) return { view: false, act: false };
  const view = canSeePage(p, page);
  return { view, act: view && (p.isAdmin || p.canApprove || !p.needsApproval) };
}
export async function requireFloat(page: string, cap: keyof FloatCaps) {
  const { userId, perms } = await getCurrentUserAndPermissions();
  if (!userId || !perms) throw unauthorized();
  const caps = floatCaps(perms, page);
  if (!caps[cap]) throw forbidden();
  return { userId, caps };
}

/** Bank lines nobody has explained yet: no ledger link, not set aside. */
const OPEN_LINE: Prisma.BankTransactionWhereInput = { reconciliationStatus: { in: ["UNMATCHED", "MANUAL_REVIEW"] }, matches: { none: {} }, direction: "DEBIT" };

const LINE_SELECT = {
  id: true,
  txnDate: true,
  description: true,
  transactionType: true,
  direction: true,
  debitAmount: true,
  integration: { select: { bankName: true, accountLastFour: true } },
} satisfies Prisma.BankTransactionSelect;
type LineRow = Prisma.BankTransactionGetPayload<{ select: typeof LINE_SELECT }>;

const openLine = (l: LineRow, suggested: boolean): OpenLine => ({
  id: l.id,
  date: fromPrismaDate(l.txnDate),
  account: `${l.integration.bankName} ••${l.integration.accountLastFour}`,
  description: l.description,
  amount: (fromDecimal(l.debitAmount) ?? 0) / 100,
  suggested,
});

const TX_OPTS = { timeout: 20_000, maxWait: 10_000 };

// ─── Settings ───────────────────────────────────────────────────────────────

const PETTY_START = "petty_cash_start";
const OM_START = "outdoor_marketing_start";
const CARD_START = "director_card_start_on";
const CARD_PAYEE = "director_card_payee_words";
const DEFAULT_START = "2026-04-01";

type FloatStart = { on: string; balance: number };
async function readSetting(key: string): Promise<string | null> {
  return (await prisma.appSetting.findUnique({ where: { key }, select: { value: true } }))?.value ?? null;
}
async function writeSetting(key: string, value: string, userId: string) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value, updatedById: userId }, update: { value, updatedById: userId } });
}
async function floatStart(key: string): Promise<FloatStart> {
  try {
    const v = JSON.parse((await readSetting(key)) ?? "null") as { on?: string; balance?: number } | null;
    if (v?.on && /^\d{4}-\d{2}-01$/.test(v.on)) return { on: v.on, balance: Math.round(Number(v.balance) || 0) };
  } catch {
    /* fall through */
  }
  return { on: DEFAULT_START, balance: 0 };
}
export async function setFloatStart(kind: CashKind, on: string, balanceRupees: number, userId: string) {
  if (!/^\d{4}-\d{2}-01$/.test(on)) throw badRequest("Start on the first of a month");
  if (!Number.isFinite(balanceRupees) || balanceRupees < 0 || balanceRupees > 1e9) throw badRequest("Enter the cash in hand on that day");
  const key = kind === "PETTY_CASH" ? PETTY_START : OM_START;
  await writeSetting(key, JSON.stringify({ on, balance: Math.round(balanceRupees * 100) }), userId);
  await recordAudit({ entityType: "AppSetting", entityId: key, action: "UPDATE", userId, changes: { on, balance: balanceRupees } });
}

// ─── Cash withdrawals ───────────────────────────────────────────────────────

/** Withdrawals waiting for a tag: ATM / cash debits by default, or every open debit. */
export async function withdrawalsToTag(everyDebit = false): Promise<OpenLine[]> {
  const rows = await prisma.bankTransaction.findMany({
    where: OPEN_LINE,
    select: LINE_SELECT,
    orderBy: [{ txnDate: "desc" }, { rowIndex: "asc" }],
    take: everyDebit ? 300 : 2000,
  });
  return rows.filter((r) => everyDebit || looksLikeCashWithdrawal(r)).map((r) => openLine(r, looksLikeCashWithdrawal(r)));
}

/**
 * Tag a bank debit as cash into a float. The line reads CASH from then on (it
 * needs no ledger entry); claimed by status, so it is never tagged twice or
 * tagged after someone matched it.
 */
export async function tagWithdrawal(bankTransactionId: string, kind: CashKind, opts: { heldBy?: string | null; note?: string | null }, userId: string) {
  const line = await prisma.bankTransaction.findUnique({ where: { id: bankTransactionId }, select: LINE_SELECT });
  if (!line) throw notFound("Bank transaction not found");
  if (line.direction !== "DEBIT") throw badRequest("Only money leaving the bank can be a cash withdrawal");
  const heldBy = (opts.heldBy ?? "").trim() || (kind === "OUTDOOR_MARKETING" ? "Director" : null);
  const created = await prisma
    .$transaction(async (tx) => {
      const c = await tx.bankTransaction.updateMany({
        where: { id: bankTransactionId, ...OPEN_LINE },
        data: { reconciliationStatus: "CASH", reconciliationNote: `Cash withdrawal: ${CASH_KIND_LABEL[kind]}`, reconciledById: userId, reconciledAt: new Date() },
      });
      if (!c.count) throw conflict("This line was explained in the meantime — reload", "line_taken");
      return tx.cashWithdrawal.create({
        data: { bankTransactionId, kind, date: line.txnDate, amount: line.debitAmount, heldBy, note: opts.note?.trim() || null, createdById: userId },
      });
    }, TX_OPTS)
    .catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("This line is already tagged", "line_taken");
      throw e;
    });
  await recordAudit({ entityType: "CashWithdrawal", entityId: created.id, action: "CREATE", userId, changes: { bankTransactionId, kind, heldBy } });
  return created;
}

/** Undo a tag: the withdrawal goes, the line is unexplained again. */
export async function untagWithdrawal(id: string, userId: string) {
  const w = await prisma.cashWithdrawal.findUnique({ where: { id } });
  if (!w) throw notFound("Withdrawal not found");
  await prisma.$transaction(async (tx) => {
    await tx.cashWithdrawal.delete({ where: { id } });
    if (w.bankTransactionId) {
      await tx.bankTransaction.updateMany({
        where: { id: w.bankTransactionId, reconciliationStatus: "CASH" },
        data: { reconciliationStatus: "UNMATCHED", reconciliationNote: null, reconciledById: userId, reconciledAt: new Date() },
      });
    }
  }, TX_OPTS);
  await recordAudit({ entityType: "CashWithdrawal", entityId: id, action: "DELETE", userId, changes: { kind: w.kind, amount: w.amount.toString() } });
}

// ─── Outdoor Marketing vouchers ─────────────────────────────────────────────

export async function importVouchers(buf: Uint8Array, userId: string) {
  const { rows, problems } = parseVoucherSheet(buf, todayIst());
  if (problems.length) return { inserted: 0, duplicates: 0, problems };
  if (!rows.length) return { inserted: 0, duplicates: 0, problems: ["No vouchers in the sheet"] };
  const hashes = voucherHashes(rows);
  const batchId = `batch_${Date.now().toString(36)}`;
  const { count } = await prisma.outdoorMarketingVoucher.createMany({
    data: rows.map((r, i) => ({
      date: toPrismaDate(r.date),
      voucherNo: r.voucherNo,
      paidTo: r.paidTo,
      purpose: r.purpose,
      amount: toDecimalString(r.amount),
      batchId,
      rowHash: hashes[i],
      createdById: userId,
    })),
    skipDuplicates: true,
  });
  await recordAudit({ entityType: "OutdoorMarketingVoucher", entityId: batchId, action: "CREATE", userId, changes: { rows: rows.length, inserted: count } });
  return { inserted: count, duplicates: rows.length - count, problems: [] };
}

export async function deleteVoucher(id: string, userId: string) {
  const v = await prisma.outdoorMarketingVoucher.findUnique({ where: { id } });
  if (!v) throw notFound("Voucher not found");
  await prisma.outdoorMarketingVoucher.delete({ where: { id } });
  await recordAudit({ entityType: "OutdoorMarketingVoucher", entityId: id, action: "DELETE", userId, changes: { date: v.date, paidTo: v.paidTo, amount: v.amount.toString() } });
}

// ─── Statements ─────────────────────────────────────────────────────────────

const paise = (d: { toString(): string }) => fromDecimal(d) ?? 0;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The Cash Floats page: what to tag, petty cash month by month, the Outdoor Marketing register. */
export async function cashFloatsView(everyDebit = false): Promise<CashFloatsData> {
  const today = todayIst();
  const [toTag, withdrawals, cashSpend, vouchers, pettyStart, omStart] = await Promise.all([
    withdrawalsToTag(everyDebit),
    prisma.cashWithdrawal.findMany({
      orderBy: { date: "desc" },
      include: { bankTransaction: { select: { description: true, integration: { select: { bankName: true, accountLastFour: true } } } } },
    }),
    prisma.transaction.findMany({
      where: { paymentMode: CASH_MODE, type: "Expense", deletedAt: null, isHistorical: false },
      select: { id: true, date: true, amount: true, category: true, subItem: true, description: true },
      orderBy: { date: "desc" },
    }),
    prisma.outdoorMarketingVoucher.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
    floatStart(PETTY_START),
    floatStart(OM_START),
  ]);
  const ins = (kind: CashKind) => withdrawals.filter((w) => w.kind === kind).map((w) => ({ date: day(w.date), amount: paise(w.amount) }));
  const petty = floatMonths(pettyStart, ins("PETTY_CASH"), cashSpend.map((t) => ({ date: day(t.date), amount: paise(t.amount) })), today);
  const om = floatMonths(omStart, ins("OUTDOOR_MARKETING"), vouchers.map((v) => ({ date: day(v.date), amount: paise(v.amount) })), today);
  const rupees = <T extends { opening: number; in: number; out: number; closing: number }>(m: T) => ({
    ...m,
    opening: m.opening / 100,
    in: m.in / 100,
    out: m.out / 100,
    closing: m.closing / 100,
  });
  return {
    toTag,
    withdrawals: withdrawals.map((w) => ({
      id: w.id,
      kind: w.kind as CashKind,
      date: day(w.date),
      amount: paise(w.amount) / 100,
      heldBy: w.heldBy,
      note: w.note,
      line: w.bankTransaction ? `${w.bankTransaction.integration.bankName} ••${w.bankTransaction.integration.accountLastFour} · ${w.bankTransaction.description}` : null,
    })),
    petty: { start: { on: pettyStart.on, balance: pettyStart.balance / 100 }, months: petty.map(rupees), spend: cashSpend.slice(0, 200).map((t) => ({ id: t.id, date: day(t.date), amount: paise(t.amount) / 100, what: `${t.category} · ${t.subItem}`, description: t.description })) },
    om: {
      start: { on: omStart.on, balance: omStart.balance / 100 },
      months: om.map(rupees),
      vouchers: vouchers.map((v) => ({ id: v.id, date: day(v.date), voucherNo: v.voucherNo, paidTo: v.paidTo, purpose: v.purpose, amount: paise(v.amount) / 100 })),
    },
  };
}

// ─── Director's card ────────────────────────────────────────────────────────

export async function setCardSettings(startOn: string, payeeWords: string, userId: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startOn)) throw badRequest("Pick the date claims are counted from");
  const words = payeeWords.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 10).join(", ");
  await writeSetting(CARD_START, startOn, userId);
  await writeSetting(CARD_PAYEE, words, userId);
  await recordAudit({ entityType: "AppSetting", entityId: CARD_START, action: "UPDATE", userId, changes: { startOn, payeeWordsSet: !!words } });
}

/** Mark a bank payment to the director as settling card claims. */
export async function markSettlement(bankTransactionId: string, note: string | null, userId: string) {
  const line = await prisma.bankTransaction.findUnique({ where: { id: bankTransactionId }, select: LINE_SELECT });
  if (!line) throw notFound("Bank transaction not found");
  if (line.direction !== "DEBIT") throw badRequest("A settlement is money paid out to the director");
  const created = await prisma
    .$transaction(async (tx) => {
      const c = await tx.bankTransaction.updateMany({
        where: { id: bankTransactionId, ...OPEN_LINE },
        data: { reconciliationStatus: "CLAIM_SETTLEMENT", reconciliationNote: "Director's card claims repaid", reconciledById: userId, reconciledAt: new Date() },
      });
      if (!c.count) throw conflict("This line was explained in the meantime — reload", "line_taken");
      return tx.directorClaimSettlement.create({
        data: { bankTransactionId, date: line.txnDate, amount: line.debitAmount, note: note?.trim() || null, createdById: userId },
      });
    }, TX_OPTS)
    .catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("This line is already a settlement", "line_taken");
      throw e;
    });
  await recordAudit({ entityType: "DirectorClaimSettlement", entityId: created.id, action: "CREATE", userId, changes: { bankTransactionId } });
  return created;
}

export async function unmarkSettlement(id: string, userId: string) {
  const s = await prisma.directorClaimSettlement.findUnique({ where: { id } });
  if (!s) throw notFound("Settlement not found");
  await prisma.$transaction(async (tx) => {
    await tx.directorClaimSettlement.delete({ where: { id } });
    if (s.bankTransactionId) {
      await tx.bankTransaction.updateMany({
        where: { id: s.bankTransactionId, reconciliationStatus: "CLAIM_SETTLEMENT" },
        data: { reconciliationStatus: "UNMATCHED", reconciliationNote: null, reconciledById: userId, reconciledAt: new Date() },
      });
    }
  }, TX_OPTS);
  await recordAudit({ entityType: "DirectorClaimSettlement", entityId: id, action: "DELETE", userId, changes: { amount: s.amount.toString() } });
}

/** The Director's Card page: claims (oldest settled first), settlements, the monthly statement, and debits that may be settlements. */
export async function directorCardView(everyDebit = false): Promise<DirectorCardData> {
  const today = todayIst();
  const startOn = (await readSetting(CARD_START)) ?? DEFAULT_START;
  const words = ((await readSetting(CARD_PAYEE)) ?? "").split(",").map((w) => w.trim()).filter(Boolean);
  const [claimRows, settlementRows, open] = await Promise.all([
    prisma.transaction.findMany({
      where: { paymentMode: DIRECTOR_CARD_MODE, type: "Expense", deletedAt: null, isHistorical: false, date: { gte: toPrismaDate(startOn) } },
      select: { id: true, date: true, amount: true, category: true, subItem: true, description: true, party: { select: { name: true } } },
    }),
    prisma.directorClaimSettlement.findMany({
      include: { bankTransaction: { select: { description: true, integration: { select: { bankName: true, accountLastFour: true } } } } },
    }),
    prisma.bankTransaction.findMany({ where: OPEN_LINE, select: LINE_SELECT, orderBy: [{ txnDate: "desc" }, { rowIndex: "asc" }], take: everyDebit ? 300 : 2000 }),
  ]);
  const claims = claimRows.map((c) => ({ id: c.id, date: day(c.date), amount: paise(c.amount) }));
  const settlements = settlementRows.map((s) => ({ id: s.id, date: day(s.date), amount: paise(s.amount) }));
  const alloc = allocateClaims(claims, settlements);
  const meta = new Map(claimRows.map((c) => [c.id, c]));
  return {
    settings: { startOn, payeeWords: words.join(", ") },
    totals: {
      claimed: alloc.totals.claimed / 100,
      repaid: alloc.totals.repaid / 100,
      outstanding: alloc.totals.outstanding / 100,
      unapplied: alloc.totals.unapplied / 100,
    },
    months: claimMonths(claims, settlements, today).map((m) => ({ ...m, claimed: m.claimed / 100, repaid: m.repaid / 100, outstanding: m.outstanding / 100 })),
    claims: alloc.claims
      .slice()
      .reverse()
      .map((c) => {
        const m = meta.get(c.id)!;
        return {
          id: c.id,
          date: c.date,
          amount: c.amount / 100,
          settled: c.settled / 100,
          outstanding: c.outstanding / 100,
          settledOn: c.settledOn,
          what: `${m.category} · ${m.subItem}`,
          paidTo: m.party?.name ?? null,
          description: m.description,
        };
      }),
    settlements: settlementRows
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .map((s) => ({
        id: s.id,
        date: day(s.date),
        amount: paise(s.amount) / 100,
        note: s.note,
        line: s.bankTransaction ? `${s.bankTransaction.integration.bankName} ••${s.bankTransaction.integration.accountLastFour} · ${s.bankTransaction.description}` : null,
      })),
    candidates: open
      .map((l) => openLine(l, words.length > 0 && namesPayee(l.description, words)))
      .filter((l) => everyDebit || l.suggested)
      .slice(0, 300),
  };
}
