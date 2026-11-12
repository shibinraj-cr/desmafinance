/**
 * BDE incentive engine — pure. Marketing Admin sets, per L2 BDE per month, a
 * minimum and up to four slabs on the Lead Pulse target sheet, plus month-wide
 * bonuses and team targets; this turns those settings and a month's facts into
 * pay. No prisma import: `crm-incentive-data.ts` fetches, this computes, so
 * every rule is unit-tested and the My Day card, the 9 AM brief and the
 * Marketing sheet can never disagree.
 *
 * Rules:
 *   - Slabs are all-units: the highest slab reached pays its rate on EVERY
 *     enrolment in the month (from 10 at ₹1,000 → 10 enrolments pay ₹10,000;
 *     from 16 at ₹1,500 → 16 pay ₹24,000). Below slab 1 nothing is paid.
 *   - The minimum is the expected level and pays nothing; it gates the BDE's
 *     share of a team pool.
 *   - Bonuses, on top: a flat amount for reaching the month's target, and a
 *     per-enrolment amount for each close within 48 hours of assignment and
 *     each own candidate referral.
 *   - A team pool is released when the team's combined enrolments reach its
 *     target. Everyone's enrolments count toward the target; the pool is split
 *     by enrolments among members who reached their own minimum. For a quarter
 *     the minimum is the member's monthly minimums added up.
 *   - Enrolments are service-weighted (a half-weight service counts 0.5), as in
 *     the L2 targets matrix.
 */

export const SLAB_COUNT = 4;
export const FAST_CLOSE_HOURS = 48;

export type Slab = { from: number; rate: number };

/** The slab columns of a LeadPulseIncentive row. */
export type SlabColumns = {
  slab1From: number | null;
  slab1Rate: number | null;
  slab2From: number | null;
  slab2Rate: number | null;
  slab3From: number | null;
  slab3Rate: number | null;
  slab4From: number | null;
  slab4Rate: number | null;
};

export type SlabInput = { from: number | null; rate: number | null };

export type MonthBonuses = { targetBonus: number; fastCloseBonus: number; referralBonus: number };

export const NO_BONUSES: MonthBonuses = { targetBonus: 0, fastCloseBonus: 0, referralBonus: 0 };

/** One BDE's month: weighted enrolments, and the counts the bonuses pay on. */
export type BdeMonthFacts = { enrolled: number; fastCloses: number; referrals: number };

// ── Slabs ────────────────────────────────────────────────────────────────────

/** The four slab inputs of a row, in order, empty ones included. */
export function slabInputs(row: SlabColumns): SlabInput[] {
  return [
    { from: row.slab1From, rate: row.slab1Rate },
    { from: row.slab2From, rate: row.slab2Rate },
    { from: row.slab3From, rate: row.slab3Rate },
    { from: row.slab4From, rate: row.slab4Rate },
  ];
}

/** The set slabs of a row (both `from` and `rate` present), in slab order. */
export function slabsFromRow(row: SlabColumns): Slab[] {
  return slabInputs(row).flatMap((s) => (s.from !== null && s.rate !== null ? [{ from: s.from, rate: s.rate }] : []));
}

/** Slab inputs back to row columns, padding to four. */
export function slabColumns(slabs: SlabInput[]): SlabColumns {
  const at = (i: number): SlabInput => slabs[i] ?? { from: null, rate: null };
  return {
    slab1From: at(0).from,
    slab1Rate: at(0).rate,
    slab2From: at(1).from,
    slab2Rate: at(1).rate,
    slab3From: at(2).from,
    slab3Rate: at(2).rate,
    slab4From: at(3).from,
    slab4Rate: at(3).rate,
  };
}

/**
 * Why a BDE's slab inputs can't be saved, or null when they can: at most four;
 * each slab has both a count and an amount or neither; filled in order with no
 * gaps; whole numbers (count ≥ 1, amount ≥ 0); each slab starts higher than
 * the one before and pays at least as much.
 */
export function validateSlabs(slabs: SlabInput[]): string | null {
  if (slabs.length > SLAB_COUNT) return `At most ${SLAB_COUNT} slabs.`;
  let seenEmpty = false;
  let prev: Slab | null = null;
  for (let i = 0; i < slabs.length; i++) {
    const { from, rate } = slabs[i];
    const n = i + 1;
    if (from === null && rate === null) {
      seenEmpty = true;
      continue;
    }
    if (from === null || rate === null) return `Slab ${n} needs both a starting count and an amount.`;
    if (seenEmpty) return `Fill slabs in order — slab ${n} is set but an earlier one is empty.`;
    if (!Number.isInteger(from) || from < 1) return `Slab ${n} must start at a whole number of 1 or more.`;
    if (!Number.isInteger(rate) || rate < 0) return `Slab ${n} amount must be a whole number of rupees.`;
    if (prev && from <= prev.from) return `Slab ${n} must start higher than slab ${n - 1} (${prev.from}).`;
    if (prev && rate < prev.rate) return `Slab ${n} must pay at least as much as slab ${n - 1} (₹${prev.rate}).`;
    prev = { from, rate };
  }
  return null;
}

/** Index of the highest slab whose start `enrolled` has reached, or null. */
export function slabReached(enrolled: number, slabs: Slab[]): number | null {
  let found: number | null = null;
  slabs.forEach((s, i) => {
    if (enrolled >= s.from && (found === null || s.from >= slabs[found].from)) found = i;
  });
  return found;
}

// ── Individual pay ───────────────────────────────────────────────────────────

export type BdePay = {
  /** Index into the slabs of the slab paying, or null below slab 1. */
  slabIndex: number | null;
  rate: number;
  slabPay: number;
  targetMet: boolean;
  targetPay: number;
  fastPay: number;
  referralPay: number;
  total: number;
};

export type BdePayInput = BdeMonthFacts & { target: number; slabs: Slab[]; bonuses: MonthBonuses };

/** One BDE's month pay. Rupees, rounded — weighted enrolments can be fractional. */
export function computeBdePay(input: BdePayInput): BdePay {
  const slabIndex = slabReached(input.enrolled, input.slabs);
  const rate = slabIndex === null ? 0 : input.slabs[slabIndex].rate;
  const slabPay = Math.round(input.enrolled * rate);
  const targetMet = input.target > 0 && input.enrolled >= input.target;
  const targetPay = targetMet ? input.bonuses.targetBonus : 0;
  const fastPay = input.fastCloses * input.bonuses.fastCloseBonus;
  const referralPay = input.referrals * input.bonuses.referralBonus;
  return { slabIndex, rate, slabPay, targetMet, targetPay, fastPay, referralPay, total: slabPay + targetPay + fastPay + referralPay };
}

export type Milestone = {
  kind: "minimum" | "slab" | "target";
  /** Enrolments at which it is reached. */
  at: number;
  reached: boolean;
  /** Enrolments still needed (0 once reached; can be fractional). */
  gap: number;
  /** For a slab: its index and rate. */
  slabIndex: number | null;
  rate: number | null;
  /** The BDE's month pay on reaching it, everything else as today. */
  payAt: number;
};

/**
 * The BDE's ladder for the month — minimum, each slab and the target — in the
 * order they are reached. Drives "3 more for your ₹5,000 target bonus".
 */
export function milestones(input: BdePayInput & { minimum: number | null }): Milestone[] {
  const at = (enrolled: number) => computeBdePay({ ...input, enrolled: Math.max(input.enrolled, enrolled) }).total;
  const step = (kind: Milestone["kind"], n: number, slabIndex: number | null = null, rate: number | null = null): Milestone => ({
    kind,
    at: n,
    reached: input.enrolled >= n,
    gap: Math.max(0, Math.round((n - input.enrolled) * 10) / 10),
    slabIndex,
    rate,
    payAt: at(n),
  });
  const out: Milestone[] = [];
  if (input.minimum !== null && input.minimum > 0) out.push(step("minimum", input.minimum));
  input.slabs.forEach((s, i) => out.push(step("slab", s.from, i, s.rate)));
  if (input.target > 0) out.push(step("target", input.target));
  const order: Record<Milestone["kind"], number> = { minimum: 0, target: 1, slab: 2 };
  return out.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
}

/** The next milestone that pays (a slab or the target bonus), or null when none is left. */
export function nextPayingMilestone(list: Milestone[], bonuses: MonthBonuses): Milestone | null {
  return list.find((m) => !m.reached && (m.kind === "slab" || (m.kind === "target" && bonuses.targetBonus > 0))) ?? null;
}

// ── 48-hour closes ───────────────────────────────────────────────────────────

/**
 * Whether an enrolment was a close within {@link FAST_CLOSE_HOURS} of
 * assignment: from the last assignment at or before the Enroll click to the
 * click itself. With no assignment logged before the click (a lead the BDE
 * created themselves), the lead's creation counts as the assignment.
 */
export function isFastClose(opts: { enrolledAt: Date; assignedAts: Date[]; leadCreatedAt: Date }, hours = FAST_CLOSE_HOURS): boolean {
  const before = opts.assignedAts.filter((d) => d.getTime() <= opts.enrolledAt.getTime());
  const start = before.length ? Math.max(...before.map((d) => d.getTime())) : opts.leadCreatedAt.getTime();
  return opts.enrolledAt.getTime() - start <= hours * 3_600_000;
}

// ── Team pools ───────────────────────────────────────────────────────────────

export type TeamMemberPeriod = { userId: string; enrolled: number; minimum: number };

export type TeamShare = TeamMemberPeriod & {
  eligible: boolean;
  /** Share if the team hits its target, at today's split. */
  shareIfHit: number;
  /** Share actually earned: `shareIfHit` once the target is hit, else 0. */
  share: number;
};

export type TeamPool = {
  target: number;
  pool: number;
  teamTotal: number;
  hit: boolean;
  gap: number;
  members: TeamShare[];
};

/** A member shares the pool once they have enrolments and have reached their minimum. */
export function isTeamEligible(m: TeamMemberPeriod): boolean {
  return m.enrolled > 0 && m.enrolled >= m.minimum;
}

/**
 * Split `pool` in proportion to `weights`, in whole rupees, so the parts add up
 * to the pool exactly (largest remainder goes first).
 */
export function splitByWeight(pool: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (pool <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (pool * w) / total);
  const parts = raw.map(Math.floor);
  let left = pool - parts.reduce((s, p) => s + p, 0);
  const byRemainder = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    if (weights[i] <= 0) continue;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

/** One team's pool for a month or a quarter. */
export function computeTeamPool(opts: { target: number; pool: number; members: TeamMemberPeriod[] }): TeamPool {
  const teamTotal = Math.round(opts.members.reduce((s, m) => s + m.enrolled, 0) * 10) / 10;
  const hit = opts.target > 0 && teamTotal >= opts.target;
  const eligible = opts.members.map(isTeamEligible);
  const parts = splitByWeight(
    opts.pool,
    opts.members.map((m, i) => (eligible[i] ? m.enrolled : 0)),
  );
  return {
    target: opts.target,
    pool: opts.pool,
    teamTotal,
    hit,
    gap: Math.max(0, Math.round((opts.target - teamTotal) * 10) / 10),
    members: opts.members.map((m, i) => ({ ...m, eligible: eligible[i], shareIfHit: parts[i], share: hit ? parts[i] : 0 })),
  };
}

// ── Quarters ─────────────────────────────────────────────────────────────────

/** Calendar quarter 1–4 of a month (Jan–Mar = 1 … Oct–Dec = 4). */
export function quarterOf(month: number): number {
  return Math.floor((month - 1) / 3) + 1;
}

/** The three months of a quarter. */
export function quarterMonths(quarter: number): number[] {
  const first = (quarter - 1) * 3 + 1;
  return [first, first + 1, first + 2];
}

/**
 * A quarter's team memberships, with the months before teams were first set up
 * filled from the first later month that has them. Teams can start mid-quarter
 * (set up in November for Oct–Dec); without this, October's enrolments would
 * count for no team. A month with any membership saved is kept exactly as
 * saved, so a mover's months still stay with the team they were in.
 */
export function fillQuarterMemberships<T extends { month: number }>(rows: T[], months: number[]): T[] {
  const sorted = [...months].sort((a, b) => a - b);
  const saved = new Set(rows.map((r) => r.month));
  const out = [...rows];
  for (const m of sorted) {
    if (saved.has(m)) continue;
    const from = sorted.find((x) => x > m && saved.has(x));
    if (from === undefined) continue;
    out.push(...rows.filter((r) => r.month === from).map((r) => ({ ...r, month: m })));
  }
  return out;
}

/** One BDE's month inside a quarter: their team that month, enrolments and minimum. */
export type QuarterMonthFact = { month: number; teamId: string; userId: string; enrolled: number; minimum: number };

/**
 * A team's quarter members from its monthly rows: each member's enrolments and
 * minimums summed over the months they were in THIS team, so a mover's months
 * stay with the team they were in.
 */
export function quarterMembers(facts: QuarterMonthFact[], teamId: string): TeamMemberPeriod[] {
  const byUser = new Map<string, TeamMemberPeriod>();
  for (const f of facts) {
    if (f.teamId !== teamId) continue;
    const cur = byUser.get(f.userId) ?? { userId: f.userId, enrolled: 0, minimum: 0 };
    cur.enrolled = Math.round((cur.enrolled + f.enrolled) * 10) / 10;
    cur.minimum += f.minimum;
    byUser.set(f.userId, cur);
  }
  return [...byUser.values()];
}

// ── Setup (the Marketing target sheet) ───────────────────────────────────────

export type LadderBand = {
  from: number;
  /** Last enrolment count in the band, or null for the top band. */
  to: number | null;
  rate: number;
  /** Slab pay at the band's first and last count (null: open-ended). */
  payFrom: number;
  payTo: number | null;
};

/**
 * A BDE's slabs as pay bands from zero — "0–9 pay nothing, 10–15 pay ₹1,000 on
 * every enrolment …" — for the sheet's preview. Empty when no slab is set.
 */
export function slabLadder(slabs: Slab[]): LadderBand[] {
  if (!slabs.length) return [];
  const bands: LadderBand[] = [{ from: 0, to: slabs[0].from - 1, rate: 0, payFrom: 0, payTo: 0 }];
  slabs.forEach((s, i) => {
    const to = i + 1 < slabs.length ? slabs[i + 1].from - 1 : null;
    bands.push({ from: s.from, to, rate: s.rate, payFrom: s.from * s.rate, payTo: to === null ? null : to * s.rate });
  });
  return bands;
}

/**
 * Whether a month's incentive setup is closed: any month before the current
 * one (`today` is an IST YYYY-MM-DD). A closed month's pay is settled, so only
 * an admin may still change its slabs, bonuses or teams.
 */
export function isIncentiveMonthClosed(year: number, month: number, today: string): boolean {
  const [ty, tm] = today.split("-").map(Number);
  return year * 12 + month < ty * 12 + tm;
}

/** The first BDE placed in two teams in one month's membership, or null. */
export function doubleBookedMember(teams: Array<{ teamId: string; userIds: string[] }>): string | null {
  const seen = new Set<string>();
  for (const t of teams) {
    for (const id of t.userIds) {
      if (seen.has(id)) return id;
      seen.add(id);
    }
  }
  return null;
}
