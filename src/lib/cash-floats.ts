/**
 * Cash floats and the director's card, pure rules.
 *
 * Cash withdrawn from a DesGro bank account is not an expense and not an
 * outflow: it moves money from the bank into a float. Two floats:
 *   - Outdoor Marketing: held by the director and spent against vouchers the
 *     director uploads as Excel. A register only, never in P&L.
 *   - Petty Cash: spent through ledger entries paid in Cash.
 * A float's balance = what went in (withdrawals) − what went out.
 *
 * The director's card: every expense paid on the director's personal credit
 * card (ledger payment mode "Credit Card") is owed to the director; a bank
 * payment to the director settles them, oldest first, and is never a second
 * expense.
 *
 * Money is integer paise throughout. Client-safe: the voucher reader, which
 * needs Node, is in cash-floats-vouchers.ts.
 */

export const CASH_KINDS = ["OUTDOOR_MARKETING", "PETTY_CASH"] as const;
export type CashKind = (typeof CASH_KINDS)[number];
export const CASH_KIND_LABEL: Record<CashKind, string> = { OUTDOOR_MARKETING: "Outdoor Marketing", PETTY_CASH: "Petty Cash" };

/** The ledger payment mode of the director's personal card (and only that card). */
export const DIRECTOR_CARD_MODE = "Credit Card";
/** Petty cash is spent through ledger entries with this payment mode. */
export const CASH_MODE = "Cash";

/** An ATM or counter withdrawal, by the classifier's type or the narration. */
export function looksLikeCashWithdrawal(l: { direction: string; transactionType: string; description: string }): boolean {
  if (l.direction !== "DEBIT") return false;
  if (l.transactionType === "ATM" || l.transactionType === "CASH") return true;
  return /\b(ATM|ATW|NWD|EAW|CASH WDL|CASH WITHDRAWAL|SELF)\b/.test(` ${l.description.toUpperCase().replace(/[-/:]/g, " ")} `);
}

/** True when a bank narration names the director (any configured word of 3+ letters). */
export function namesPayee(description: string, words: string[]): boolean {
  const narr = ` ${description.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  return words.map((w) => w.trim().toUpperCase()).filter((w) => w.length >= 3).some((w) => narr.includes(` ${w} `));
}

export type Movement = { date: string; amount: number };
export type FloatMonth = { month: string; opening: number; in: number; out: number; closing: number };

const monthOf = (d: string) => d.slice(0, 7);
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * A float month by month: opening, in, out, closing. `start` is where the
 * statement begins (the first of a month) with the float's balance then;
 * movements before it are already in that balance and are left out.
 */
export function floatMonths(start: { on: string; balance: number }, ins: Movement[], outs: Movement[], until: string): FloatMonth[] {
  const first = monthOf(start.on);
  const last = [until, ...ins.map((m) => m.date), ...outs.map((m) => m.date)].map(monthOf).sort().pop()!;
  const sum = (list: Movement[], ym: string) => list.filter((m) => m.date >= start.on && monthOf(m.date) === ym).reduce((s, m) => s + m.amount, 0);
  const rows: FloatMonth[] = [];
  let balance = start.balance;
  for (let ym = first; ym <= last; ym = nextMonth(ym)) {
    const i = sum(ins, ym);
    const o = sum(outs, ym);
    rows.push({ month: ym, opening: balance, in: i, out: o, closing: balance + i - o });
    balance += i - o;
  }
  // Months before anything happened, with nothing in hand, say nothing.
  const firstUsed = rows.findIndex((m) => m.opening !== 0 || m.in !== 0 || m.out !== 0);
  return firstUsed < 0 ? rows.slice(-1) : rows.slice(firstUsed);
}

export type Claim = { id: string; date: string; amount: number };
export type Settlement = { id: string; date: string; amount: number };
export type AllocatedClaim = Claim & { settled: number; outstanding: number; settledOn: string | null };

/**
 * Settlements clear the oldest claims first; a part payment leaves the rest
 * of a claim outstanding. Anything repaid beyond every claim is `unapplied`
 * (an advance), not a negative balance.
 */
export function allocateClaims(claims: Claim[], settlements: Settlement[]) {
  const ordered = [...claims].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const pays = [...settlements].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const out: AllocatedClaim[] = ordered.map((c) => ({ ...c, settled: 0, outstanding: c.amount, settledOn: null }));
  let i = 0;
  let unapplied = 0;
  for (const p of pays) {
    let left = p.amount;
    while (left > 0 && i < out.length) {
      const c = out[i];
      const take = Math.min(left, c.outstanding);
      c.settled += take;
      c.outstanding -= take;
      left -= take;
      if (c.outstanding === 0) {
        c.settledOn = p.date;
        i++;
      }
    }
    unapplied += left;
  }
  const claimed = claims.reduce((s, c) => s + c.amount, 0);
  const repaid = settlements.reduce((s, p) => s + p.amount, 0);
  return { claims: out, totals: { claimed, repaid, outstanding: Math.max(0, claimed - repaid), unapplied } };
}

export type ClaimMonth = { month: string; claimed: number; repaid: number; outstanding: number };

/** The director's statement: claimed and repaid each month, and what is owed at the month's end. */
export function claimMonths(claims: Claim[], settlements: Settlement[], until: string): ClaimMonth[] {
  const dates = [...claims.map((c) => c.date), ...settlements.map((s) => s.date)];
  if (!dates.length) return [];
  const first = dates.map(monthOf).sort()[0];
  const last = [until, ...dates].map(monthOf).sort().pop()!;
  const rows: ClaimMonth[] = [];
  let owed = 0;
  for (let ym = first; ym <= last; ym = nextMonth(ym)) {
    const c = claims.filter((x) => monthOf(x.date) === ym).reduce((s, x) => s + x.amount, 0);
    const r = settlements.filter((x) => monthOf(x.date) === ym).reduce((s, x) => s + x.amount, 0);
    owed += c - r;
    rows.push({ month: ym, claimed: c, repaid: r, outstanding: owed });
  }
  return rows;
}

// ─── Page data (explicit, so the pages don't make the type checker infer them through Prisma) ──

export type OpenLine = { id: string; date: string; account: string; description: string; amount: number; suggested: boolean };
export type FloatMonthRupees = { month: string; opening: number; in: number; out: number; closing: number };

export type CashFloatsData = {
  toTag: OpenLine[];
  withdrawals: Array<{ id: string; kind: CashKind; date: string; amount: number; heldBy: string | null; note: string | null; line: string | null }>;
  petty: {
    start: { on: string; balance: number };
    months: FloatMonthRupees[];
    spend: Array<{ id: string; date: string; amount: number; what: string; description: string | null }>;
  };
  om: {
    start: { on: string; balance: number };
    months: FloatMonthRupees[];
    vouchers: Array<{ id: string; date: string; voucherNo: string | null; paidTo: string; purpose: string | null; amount: number }>;
  };
};

export type DirectorCardData = {
  settings: { startOn: string; payeeWords: string };
  totals: { claimed: number; repaid: number; outstanding: number; unapplied: number };
  months: Array<{ month: string; claimed: number; repaid: number; outstanding: number }>;
  claims: Array<{ id: string; date: string; amount: number; settled: number; outstanding: number; settledOn: string | null; what: string; paidTo: string | null; description: string | null }>;
  settlements: Array<{ id: string; date: string; amount: number; note: string | null; line: string | null }>;
  candidates: OpenLine[];
};

