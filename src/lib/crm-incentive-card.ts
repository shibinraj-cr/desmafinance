/**
 * The incentive card on an L2 BDE's My Day — pure. Turns one BDE's standing
 * (`crm-incentive-data.ts`, computed by `crm-incentive.ts`) into what the card
 * says: pace, the next step, the provisional total and its breakdown, the
 * ladder and the team pools. Kept apart from the component so every sentence
 * is unit-tested, and so the 9 AM brief can say the same thing.
 *
 * `**text**` in a sentence marks the words to bold.
 */
import { FAST_CLOSE_HOURS, isTeamEligible, nextPayingMilestone, quarterMonths, type Milestone, type MonthBonuses } from "./crm-incentive";
import type { BdeStanding, TeamPoolForMember } from "./crm-incentive-data";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
/** Weighted enrolments keep one decimal: "3", "2.5". */
export const count = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const more = (n: number) => `${count(n)} more`;
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export type CardLine = { label: string; amount: number; approx?: boolean };
export type BarMarker = {
  kind: Milestone["kind"];
  at: number;
  pct: number;
  label: string;
  reached: boolean;
  /** 0 next to the bar, 1 one row further out — so labels of close steps don't overlap. */
  row: 0 | 1;
};

/** Labels closer than this (in % of the bar) go on alternate rows. */
const LABEL_GAP_PCT = 25;
export type LadderStep = {
  kind: Milestone["kind"];
  title: string;
  note: string;
  /** done: passed · current: the slab paying now · next: the first step not reached · ahead: later. */
  state: "done" | "current" | "next" | "ahead";
};
export type PoolView = { label: string; pool: number; pct: number; hit: boolean; text: string };

export type IncentiveCardView = {
  title: string;
  daysNote: string;
  enrolled: number;
  target: number;
  pace: { good: boolean; label: string } | null;
  /** False when neither a target nor slabs are set for the month. */
  setUp: boolean;
  notice: string | null;
  next: string | null;
  /** The next step is unlocking slab 1 — shown as a locked prize. */
  belowSlabs: boolean;
  bar: { markers: BarMarker[]; fillPct: number; label: string } | null;
  total: number;
  lines: CardLine[];
  ahead: CardLine[];
  ladder: LadderStep[];
  team: { name: string; eligible: boolean; status: string; pools: PoolView[] } | null;
  explain: string;
};

export type CardInput = { bde: BdeStanding; bonuses: MonthBonuses; year: number; month: number };

/** The quarter's label and last day: "Oct–Dec", "31 Dec". */
function quarterInfo(year: number, month: number): { label: string; ends: string } {
  const [first, , last] = quarterMonths(Math.floor((month - 1) / 3) + 1);
  return { label: `${SHORT[first - 1]}–${SHORT[last - 1]}`, ends: `${daysIn(year, last)} ${SHORT[last - 1]}` };
}

/** Team-pool shares already earned: the month's once hit, and the quarter's once hit (counting it is optional). */
function earnedShares(bde: BdeStanding, withQuarter: boolean): Array<{ period: "month" | "quarter"; amount: number }> {
  const out: Array<{ period: "month" | "quarter"; amount: number }> = [];
  const m = bde.team?.month?.me;
  if (bde.team?.month?.hit && m && m.share > 0) out.push({ period: "month", amount: m.share });
  const q = bde.team?.quarter?.me;
  if (withQuarter && bde.team?.quarter?.hit && q && q.share > 0) out.push({ period: "quarter", amount: q.share });
  return out;
}

function pace(enrolled: number, target: number, day: number, dim: number): IncentiveCardView["pace"] {
  if (target <= 0) return null;
  if (enrolled >= target) return { good: true, label: "Target reached" };
  const behind = (target * day) / dim - enrolled;
  if (behind <= -0.5) return { good: true, label: "Ahead of pace" };
  if (behind < 0.5) return { good: true, label: "On pace" };
  return { good: false, label: `${Math.round(behind)} behind pace` };
}

function nextStep(bde: BdeStanding, bonuses: MonthBonuses, total: number): { next: string | null; belowSlabs: boolean } {
  const { slabs, pay, milestones: ms, facts } = bde;
  if (slabs.length && pay.slabIndex === null) {
    const s = slabs[0];
    return {
      next: `Incentive starts at ${count(s.from)}. **${more(s.from - facts.enrolled)} unlocks ${rupees(s.from * s.rate)}** at once — ${rupees(s.rate)} for every enrolment.`,
      belowSlabs: true,
    };
  }
  const n = nextPayingMilestone(ms, bonuses);
  if (n?.kind === "target") {
    const after = ms.find((m) => m.kind === "slab" && !m.reached && m.at > n.at);
    const then = after ? ` — then ${more(after.at - n.at)} and all ${count(after.at)} pay ${rupees(after.rate ?? 0)} each` : "";
    return { next: `**${more(n.gap)}** for your **${rupees(bonuses.targetBonus)} target bonus**${then}.`, belowSlabs: false };
  }
  if (n?.kind === "slab") {
    return {
      next: `**${more(n.gap)}** and all ${count(n.at)} pay ${rupees(n.rate ?? 0)} each — your incentive goes from ${rupees(total)} to ${rupees(n.payAt + (total - pay.total))}.`,
      belowSlabs: false,
    };
  }
  if (pay.slabIndex !== null) {
    return { next: `You've passed every step this month — each extra enrolment adds ${rupees(pay.rate)}.`, belowSlabs: false };
  }
  return { next: null, belowSlabs: false };
}

function ladder(bde: BdeStanding, bonuses: MonthBonuses): LadderStep[] {
  const ms = bde.milestones;
  const firstOpen = ms.findIndex((m) => !m.reached);
  return ms.map((m, i) => {
    const current = m.kind === "slab" && m.reached && m.slabIndex === bde.pay.slabIndex;
    const state: LadderStep["state"] = current ? "current" : m.reached ? "done" : i === firstOpen ? "next" : "ahead";
    if (m.kind === "minimum") {
      return {
        kind: m.kind,
        title: `Minimum · ${count(m.at)}`,
        note: m.reached ? "Reached" : `${more(m.gap)}${bde.team ? " — needed for a team share" : ""}`,
        state,
      };
    }
    if (m.kind === "target") {
      const bonus = bonuses.targetBonus;
      return {
        kind: m.kind,
        title: `Target · ${count(m.at)}`,
        note: m.reached ? (bonus > 0 ? `${rupees(bonus)} bonus earned` : "Reached") : bonus > 0 ? `${more(m.gap)} → +${rupees(bonus)} bonus` : more(m.gap),
        state,
      };
    }
    return {
      kind: m.kind,
      title: `Slab ${(m.slabIndex ?? 0) + 1} · ${count(m.at)}`,
      note: current ? `Earning ${rupees(m.rate ?? 0)} each` : m.reached ? "Passed" : `${more(m.gap)} → ${rupees(m.rate ?? 0)} × all`,
      state,
    };
  });
}

function bar(bde: BdeStanding): IncentiveCardView["bar"] {
  const ms = bde.milestones;
  if (!ms.length) return null;
  const enrolled = bde.facts.enrolled;
  const max = Math.max(enrolled, ...ms.map((m) => m.at)) * 1.1;
  const pct = (n: number) => Math.round((n / max) * 1000) / 10;
  // Slab labels sit above the bar, minimum and target below; on each side a
  // label too close to the one before moves out a row.
  const last: Record<"above" | "below", { pct: number; row: 0 | 1 } | null> = { above: null, below: null };
  const rowFor = (side: "above" | "below", at: number): 0 | 1 => {
    const prev = last[side];
    const row: 0 | 1 = prev && pct(at) - prev.pct < LABEL_GAP_PCT ? (prev.row === 0 ? 1 : 0) : 0;
    last[side] = { pct: pct(at), row };
    return row;
  };
  const markers: BarMarker[] = ms.map((m) => ({
    kind: m.kind,
    at: m.at,
    pct: pct(m.at),
    reached: m.reached,
    row: rowFor(m.kind === "slab" ? "above" : "below", m.at),
    label:
      m.kind === "slab"
        ? `${rupees(m.rate ?? 0)} · ${count(m.at)}`
        : m.kind === "minimum"
          ? `Min ${count(m.at)}${m.reached ? " ✓" : ""}`
          : `Target ${count(m.at)}`,
  }));
  const said = ms.map((m) =>
    m.kind === "slab" ? `slab ${(m.slabIndex ?? 0) + 1} at ${count(m.at)}` : `${m.kind} ${count(m.at)}`,
  );
  const reached = said.filter((_, i) => ms[i].reached);
  const open = said.filter((_, i) => !ms[i].reached);
  return {
    markers,
    fillPct: pct(enrolled),
    label: `${count(enrolled)} enrolments.${reached.length ? ` Reached: ${reached.join(", ")}.` : ""}${open.length ? ` Ahead: ${open.join(", ")}.` : ""}`,
  };
}

function pools(bde: BdeStanding, monthName: string, year: number, month: number): PoolView[] {
  if (!bde.team) return [];
  const q = quarterInfo(year, month);
  const view = (pool: TeamPoolForMember | null, label: string, by: string | null): PoolView | null => {
    if (!pool) return null;
    const me = pool.me;
    const sharing = me ? me.eligible : false;
    // Why the share is what it is: by enrolments, among the members who qualify.
    const basis = !me
      ? "."
      : pool.qualifying < pool.size
        ? ` — only ${pool.qualifying} of ${pool.size} members ${pool.qualifying === 1 ? "has" : "have"} reached their minimum so far.`
        : ` (your ${count(me.enrolled)} of the team's ${count(pool.teamTotal)}).`;
    const text = pool.hit
      ? sharing
        ? `Target reached — your share ≈ **${rupees(me!.share)}**${basis}`
        : "Target reached. You share it once you reach your minimum."
      : `Team needs **${more(pool.gap)}**${by ? ` by ${by}` : ""}. ` +
        (sharing
          ? `Your share at today's split ≈ **${rupees(me!.shareIfHit)}**${basis}`
          : "Your enrolments count toward it; you share once you reach your minimum.");
    return {
      label: `${label} · ${count(pool.teamTotal)} of ${count(pool.target)}`,
      pool: pool.pool,
      pct: pool.target > 0 ? Math.min(100, Math.round((pool.teamTotal / pool.target) * 100)) : 0,
      hit: pool.hit,
      text,
    };
  };
  return [view(bde.team.month, monthName, null), view(bde.team.quarter, `${q.label} quarter`, q.ends)].filter(
    (p): p is PoolView => p !== null,
  );
}

export function incentiveCard(input: CardInput & { today: string }): IncentiveCardView {
  const { bde, bonuses, year, month, today } = input;
  const monthName = MONTHS[month - 1];
  const dim = daysIn(year, month);
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  const day = ty * 12 + tm > year * 12 + month ? dim : ty * 12 + tm < year * 12 + month ? 0 : Number(today.slice(8, 10));
  const enrolled = bde.facts.enrolled;
  const setUp = bde.slabs.length > 0 || bde.target > 0;
  const q = quarterInfo(year, month);

  const shares = earnedShares(bde, true);
  const total = bde.pay.total + shares.reduce((s, x) => s + x.amount, 0);

  const lines: CardLine[] = [];
  if (bde.slabs.length) {
    lines.push(
      bde.pay.slabIndex === null
        ? { label: `${count(enrolled)} enrolments — slab 1 starts at ${count(bde.slabs[0].from)}`, amount: 0 }
        : { label: `${count(enrolled)} × ${rupees(bde.pay.rate)} (slab ${bde.pay.slabIndex + 1})`, amount: bde.pay.slabPay },
    );
  }
  if (bde.pay.targetPay > 0) lines.push({ label: `Target bonus (${count(bde.target)} reached)`, amount: bde.pay.targetPay });
  if (bde.pay.fastPay > 0) {
    lines.push({ label: `${bde.facts.fastCloses} closed within ${FAST_CLOSE_HOURS}h × ${rupees(bonuses.fastCloseBonus)}`, amount: bde.pay.fastPay });
  }
  if (bde.pay.referralPay > 0) {
    const n = bde.facts.referrals;
    lines.push({ label: `${n} own referral${n === 1 ? "" : "s"} × ${rupees(bonuses.referralBonus)}`, amount: bde.pay.referralPay });
  }
  for (const s of shares) {
    lines.push({
      label: `${bde.team!.name} ${s.period === "month" ? monthName : `${q.label} quarter`} pool share`,
      amount: s.amount,
      approx: true,
    });
  }

  const extra = total - bde.pay.total;
  const ahead: CardLine[] = bde.milestones
    .filter((m) => !m.reached && (m.kind === "slab" || (m.kind === "target" && bonuses.targetBonus > 0)))
    .slice(0, 3)
    .map((m) => ({
      label: `At ${count(m.at)} (${m.kind === "target" ? "target bonus" : `slab ${(m.slabIndex ?? 0) + 1}`})`,
      amount: m.payAt + extra,
    }));
  const monthPool = bde.team?.month;
  if (monthPool && !monthPool.hit && monthPool.me?.eligible && monthPool.me.shareIfHit > 0) {
    ahead.push({ label: `Team share if ${bde.team!.name} hits ${count(monthPool.target)}`, amount: monthPool.me.shareIfHit, approx: true });
  }

  const { next, belowSlabs } = setUp ? nextStep(bde, bonuses, total) : { next: null, belowSlabs: false };

  const notice = !setUp
    ? `Your ${monthName} target and incentive slabs aren't set yet. Every enrolment is already counting — the ladder appears here once Marketing Admin saves them.`
    : bde.slabs.length === 0
      ? `Your ${monthName} incentive slabs aren't set yet — until Marketing Admin sets them, only the bonuses count.`
      : null;

  let team: IncentiveCardView["team"] = null;
  if (bde.team) {
    const minimum = bde.minimum ?? 0;
    const eligible = isTeamEligible({ userId: bde.userId, enrolled, minimum });
    team = {
      name: bde.team.name,
      eligible,
      status: eligible
        ? minimum > 0
          ? `You share the team pools — minimum ${count(minimum)} reached`
          : "You share the team pools"
        : minimum > enrolled
          ? `Reach your minimum of ${count(minimum)} to share the pools — ${more(minimum - enrolled)}`
          : "Your first enrolment puts you in the team pools",
      pools: pools(bde, monthName, year, month),
    };
  }

  const extras = [
    bonuses.targetBonus > 0 ? `reaching your target adds ${rupees(bonuses.targetBonus)}` : null,
    bonuses.fastCloseBonus > 0 ? `each enrolment closed within ${FAST_CLOSE_HOURS} hours of assignment adds ${rupees(bonuses.fastCloseBonus)}` : null,
    bonuses.referralBonus > 0 ? `each own referral enrolled adds ${rupees(bonuses.referralBonus)}` : null,
  ].filter(Boolean);
  const explain =
    "Counts your CRM enrolments live — a half-weight service counts 0.5. The highest slab you reach pays on every enrolment in the month" +
    (extras.length ? `; ${extras.join("; ")}` : "") +
    ". Team pools are split by enrolments among members who reach their minimum. Marketing Admin sets your target, slabs, bonuses and team; Finance confirms the final payout after the month ends.";

  return {
    title: `${monthName} so far`,
    daysNote: day >= dim ? "Last day of the month" : `Day ${day} of ${dim} · ${dim - day} day${dim - day === 1 ? "" : "s"} left`,
    enrolled,
    target: bde.target,
    pace: pace(enrolled, bde.target, Math.max(day, 1), dim),
    setUp,
    notice,
    next,
    belowSlabs,
    bar: setUp ? bar(bde) : null,
    total,
    lines,
    ahead,
    ladder: setUp ? ladder(bde, bonuses) : [],
    team,
    explain,
  };
}

/**
 * Last month's result, for the first days of a month: "**October closed:** 15
 * enrolled → ₹28,100 — …". The quarter pool counts only when that month ended
 * the quarter. Null when there was nothing to earn.
 */
export function closedMonthLine(input: CardInput): string | null {
  const { bde, month } = input;
  const endsQuarter = month % 3 === 0;
  const shares = earnedShares(bde, endsQuarter);
  const teamShare = shares.reduce((s, x) => s + x.amount, 0);
  const total = bde.pay.total + teamShare;
  if (!bde.slabs.length && bde.target <= 0 && total === 0) return null;
  const parts = [
    bde.pay.slabPay > 0 ? `${rupees(bde.pay.slabPay)} slab ${(bde.pay.slabIndex ?? 0) + 1}` : null,
    bde.pay.targetPay > 0 ? `${rupees(bde.pay.targetPay)} target bonus` : null,
    bde.pay.fastPay + bde.pay.referralPay > 0 ? `${rupees(bde.pay.fastPay + bde.pay.referralPay)} other bonuses` : null,
    teamShare > 0 ? `${rupees(teamShare)} team share` : null,
  ].filter(Boolean);
  return (
    `**${MONTHS[month - 1]} closed:** ${count(bde.facts.enrolled)} enrolled → **${rupees(total)}**` +
    (parts.length ? ` (${parts.join(", ")})` : "") +
    ". Provisional until Finance confirms."
  );
}
