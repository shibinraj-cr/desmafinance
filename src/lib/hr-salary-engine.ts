import { prisma } from "./prisma";
import { cycleWindowForMonth, structureForMonth, computeLateTags, type LateTag } from "./hr-data";
import { computeMonthlyLeaveLedger } from "./hr-leave-balance";
import {
  computePf,
  pfSegmentsForWindow,
  toPfRule,
  LEGACY_PF_RULE,
  type PfBasis,
  type PfSegment,
  type PfSegmentCalc,
} from "./hr-pf";

/**
 * Salary calculation engine.
 *
 * Inputs (from HrSalaryStructure):
 *   basic, hraPct, conveyancePct, medicalPct, specialPct
 *
 * Derived components (live):
 *   hra        = basic × hraPct%
 *   conveyance = basic × conveyancePct%
 *   medical    = basic × medicalPct%
 *   special    = basic × specialPct%
 *   gross      = basic + hra + conveyance + medical + special
 *                (with default 50/25/35/40 → gross = basic × 2.5)
 *
 * Payroll month math (mirrors the reference Jan–Apr 2026 calc files):
 *   workingDaysBase = 30  (calendar default; editable per run)
 *   dailyBasis      = gross / workingDaysBase
 *   daysAttended    = workingDaysBase − totalLeaveForLop   (paid days)
 *   basicAfterLop   = basic × (daysAttended / workingDaysBase)
 *   salaryBeforeEsi = gross − (dailyBasis × totalLeaveForLop)
 *   ESI employee 0.75% · employer 3.25% on salaryBeforeEsi
 *     (only if esiApplicable AND gross ≤ ₹21,000 statutory ceiling)
 *   PF  employee 12%   · employer 12%   on basicAfterLop   (if pfApplicable)
 *   PT  = professionalTax (flat, set by Kerala slab)
 *   net = salaryBeforeEsi − ESI(E) − PF(E) − PT
 */

/// Company-wide CTC split (effective May 2026 onwards). Each allowance
/// is a % of Basic. Total allowances = 100% → Gross = Basic × 2.
export const DEFAULT_ALLOWANCE_PCTS = {
  hra: 40,
  conveyance: 20,
  medical: 25,
  special: 15,
} as const;

/// Statutory rates. Employer-side ESI was historically 3.25% but DESMA's
/// payroll uses 3.75% (per the May 2026 salary structure sheet).
export const ESI_EMPLOYEE_RATE = 0.0075;
export const ESI_EMPLOYER_RATE = 0.0375;
/// LEGACY PF constants. PF is now governed by effective-dated HrPfRule rows
/// (see src/lib/hr-pf.ts) selected by salary-period date — ₹15,000 through
/// 16 Sep 2026, ₹25,000 from 17 Sep 2026. These constants only back the
/// built-in fallback rule applied when no HrPfRule covers a period, and the
/// pre-rules behaviour pinned by older tests.
export const PF_RATE = 0.12;
export const PF_WAGE_CEILING = 15000;
export const PF_CONTRIBUTION_CAP = PF_WAGE_CEILING * PF_RATE; // 1800

/**
 * Trainees are paid on BASIC ONLY: no allowances, no ESI, no PF, no PT.
 * Enforced by designation NAME (case-insensitive, trimmed) of the employee's
 * effective designation — see `effectiveDesignation`.
 */
export const TRAINEE_DESIGNATION_NAME = "Trainee";

export function isTraineeDesignation(name?: string | null): boolean {
  return (name ?? "").trim().toLowerCase() === TRAINEE_DESIGNATION_NAME.toLowerCase();
}

/**
 * Company owners (Managing Director / Director). Attendance and leaves do not
 * apply to them: payroll pays their full structured salary every month with
 * zero loss-of-pay, and they are excluded from leave accrual / the attendance
 * grid. Matched by designation NAME (case-insensitive, trimmed) of the
 * employee's effective designation — see `effectiveDesignation`.
 */
export const OWNER_DESIGNATION_NAMES = ["Managing Director", "Director"] as const;

export function isOwnerDesignation(name?: string | null): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return n !== "" && OWNER_DESIGNATION_NAMES.some((d) => d.toLowerCase() === n);
}

/**
 * The designation an employee actually holds: the HrDesignation relation when
 * set, else the legacy free-text `employee.designation`. Same precedence the
 * employee page displays. The legacy string is never shown or edited once the
 * relation is set, so it goes stale on promotion — OR-ing the two used to keep
 * a promoted ex-Trainee on basic-only pay.
 */
export function effectiveDesignation(e: {
  designationRef?: { name: string } | null;
  designation?: string | null;
}): string | null {
  return e.designationRef?.name ?? e.designation ?? null;
}

// Ad-hoc pay-correction vocabulary lives in a Prisma-free module so client
// components can share it; re-exported here for server callers (API validation).
export {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_CATEGORIES,
  type AdjustmentKind,
  type AdjustmentCategory,
} from "./hr-adjustment-types";

export type SalaryBreakdown = {
  basic: number;
  hra: number;
  conveyance: number;
  medical: number;
  special: number;
  gross: number;
};

export type SalaryCalc = SalaryBreakdown & {
  totalWorkingDays: number;
  daysAttended: number;
  paidLeave: number;
  unpaidLeave: number;
  halfDayLeave: number;
  totalLeaveForLop: number;
  monthlySalary: number; // alias for gross — kept for HrSalaryRunLine column
  basicSalary: number; // alias for basic — kept for HrSalaryRunLine column
  basicAfterLop: number;
  dailyBasis: number;
  /** Pre-statutory penalty (₹) folded into the calc; 0 when none. */
  penalty: number;
  salaryBeforeEsi: number;
  esiEmployee: number;
  esiEmployer: number;
  /** Total employee PF deduction (statutory + voluntary). */
  pfEmployee: number;
  /** Total employer PF contribution (EPF + EPS). */
  pfEmployer: number;
  professionalTax: number;
  netSalary: number;
  esiTotal: number;
  pfTotal: number;
  // ——— PF audit detail (rule-based; see src/lib/hr-pf.ts) ———
  /** Eligible PF wage the contributions were computed on. */
  pfWage: number;
  pfEmployerEpf: number;
  pfEmployerEps: number;
  /** Statutory employee share (pfEmployee minus VPF). */
  pfEmployeeStatutory: number;
  pfEmployeeVpf: number;
  pfBasisApplied: PfBasis;
  pfCeilingApplied: boolean;
  /** Rule applied per calendar segment (2 entries on a transition cycle). */
  pfSegments: PfSegmentCalc[];
};

const round = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Derive gross + allowance breakdown from basic + percentages. */
export function deriveBreakdown(
  basic: number,
  pcts: { hraPct?: number; conveyancePct?: number; medicalPct?: number; specialPct?: number } = {},
): SalaryBreakdown {
  const hraPct = pcts.hraPct ?? DEFAULT_ALLOWANCE_PCTS.hra;
  const conveyancePct = pcts.conveyancePct ?? DEFAULT_ALLOWANCE_PCTS.conveyance;
  const medicalPct = pcts.medicalPct ?? DEFAULT_ALLOWANCE_PCTS.medical;
  const specialPct = pcts.specialPct ?? DEFAULT_ALLOWANCE_PCTS.special;
  const hra = round2((basic * hraPct) / 100);
  const conveyance = round2((basic * conveyancePct) / 100);
  const medical = round2((basic * medicalPct) / 100);
  const special = round2((basic * specialPct) / 100);
  const gross = round2(basic + hra + conveyance + medical + special);
  return { basic, hra, conveyance, medical, special, gross };
}

/**
 * Kerala Professional Tax slab (half-yearly). The amount shown is per-
 * month (slab total / 6). Source: the user's reference Salary Corrections
 * sheet:
 *   half-yearly 75k–99,999  → ₹750 ÷ 6 = ₹125/mo
 *   half-yearly 100k–124,999 → ₹1000 ÷ 6 ≈ ₹167/mo
 *   half-yearly ≥ 125k       → ₹1250 ÷ 6 ≈ ₹208/mo
 * Below 75k/half-year (i.e. gross < 12,500/mo) we still default to ₹125;
 * HR can override per employee.
 */
export function suggestProfessionalTax(grossMonthly: number): number {
  const halfYear = grossMonthly * 6;
  if (halfYear >= 125_000) return 208;
  if (halfYear >= 100_000) return 167;
  return 125;
}

/** ESI applies when gross ≤ ₹21,000/month. */
export function isEsiApplicable(grossMonthly: number): boolean {
  return grossMonthly <= 21000;
}

export function calcLine(args: {
  workingDaysBase: number;
  basic: number;
  hraPct?: number;
  conveyancePct?: number;
  medicalPct?: number;
  specialPct?: number;
  esiApplicable: boolean;
  pfApplicable: boolean;
  professionalTax: number;
  daysPresent: number;
  daysHalfDay: number;
  /**
   * Of `daysHalfDay`, how many HR granted as PAID leave. Each is charged to the
   * leave balance at 0.5 (exactly as a full-day LV is charged at 1.0) instead of
   * being docked as loss-of-pay. Defaults to 0, which reproduces the previous
   * behaviour where every half-day was pure loss-of-pay.
   */
  daysHalfDayPaid?: number;
  daysAbsent: number;
  daysPaidLeave: number;
  carriedBalanceBefore: number;
  // Days of loss-of-pay (absence / half-day / late) covered by the employee's
  // paid-leave allocation this cycle — subtracted from the LOP so they're paid.
  paidLeaveCoverForLop?: number;
  /**
   * A pre-statutory PENALTY (₹). Reduces the salary BEFORE ESI/PF/PT and is
   * treated as additional monetary loss-of-pay: gross and basic shrink
   * proportionally, so ESI and PF recompute on the reduced figures. Defaults to
   * 0 (no penalty → identical to the previous behaviour). Only "penalty"-
   * category adjustments feed this; other deductions apply post-net.
   */
  penaltyBeforeStatutory?: number;
  /**
   * Calendar days of the cycle before the employee's join date (see
   * `daysBeforeJoining`). Docked as loss-of-pay on the working-days base like an
   * absence, but AFTER the paid-leave cover — the allocation must never pay for
   * days the person wasn't yet employed. Defaults to 0 (no change).
   */
  daysBeforeJoining?: number;
  /**
   * Statutory PF rule configuration for this payroll window: the effective-
   * dated rule segments covering the cycle (built once per run via
   * pfSegmentsForWindow), the cycle's calendar-day total, and this employee's
   * contribution basis / voluntary %. Omitted → the built-in legacy rule
   * (₹15,000 ceiling, 12%) applies to the whole month, reproducing the
   * pre-rules behaviour exactly.
   */
  pf?: {
    segments: PfSegment[];
    totalDays: number;
    basis: PfBasis;
    voluntaryPct?: number | null;
  };
  /**
   * Member is not enrolled in EPS (Employee.epsExempt): the whole employer
   * PF share is credited to EPF. Reallocates between EPS and EPF only —
   * employee/employer totals and the net salary are unchanged. Defaults to
   * false (EPS member).
   */
  epsExempt?: boolean;
}): SalaryCalc {
  const wd = args.workingDaysBase;
  const breakdown = deriveBreakdown(args.basic, args);
  const gross = breakdown.gross;
  const dailyBasis = round2(gross / wd);

  // Explicit paid leave charged to the balance: full-day LV at 1.0 plus each
  // paid half-day at 0.5. Anything the balance can't cover falls through to
  // loss-of-pay, same as an over-drawn LV always has.
  const halfDayPaid = Math.min(Math.max(0, args.daysHalfDayPaid ?? 0), args.daysHalfDay);
  const paidLeaveDays = round2(args.daysPaidLeave + halfDayPaid * 0.5);
  const paidCovered = Math.min(paidLeaveDays, Math.max(0, args.carriedBalanceBefore));
  const paidUncovered = round2(Math.max(0, paidLeaveDays - paidCovered));

  // Only the half-days NOT granted as paid leave are docked here — the paid ones
  // are already accounted for above, and counting them twice would deduct 0.5
  // day of pay for leave the employee was told they'd be paid for.
  const lopBeforeCover =
    args.daysAbsent + paidUncovered + (args.daysHalfDay - halfDayPaid) * 0.5;
  const lopCover = Math.min(Math.max(0, args.paidLeaveCoverForLop ?? 0), lopBeforeCover);
  const preJoin = Math.max(0, args.daysBeforeJoining ?? 0);
  const totalLeaveForLop = round2(Math.min(wd, lopBeforeCover - lopCover + preJoin));
  // Paid days = working-days base − loss-of-pay. We derive attended days
  // from LOP rather than summing present-marked rows, so the PF base stays
  // consistent with the gross/LOP side: an employee paid the full month
  // (minus explicit LOP) must also accrue PF on the full month. Summing
  // present rows silently understated PF whenever an attendance row was
  // missing or a day was left unmarked — e.g. Greeshma, Apr 2026, whose
  // import was short ~6 present rows, so she accrued PF on 22.5 days while
  // being paid salary for 28.5. (args.daysPresent is intentionally unused;
  // unmarked days count as paid — attendance/leave marking is authoritative.)
  const daysAttended = Math.max(0, round2(wd - totalLeaveForLop));

  // Loss-of-pay reduced gross (before any penalty).
  // Floored at 0: dailyBasis is rounded, so a whole-base LOP can overshoot gross
  // by a few paise (666.67 × 30 = 20000.10).
  const grossAfterLop = Math.max(0, round2(gross - dailyBasis * totalLeaveForLop));
  // A pre-statutory penalty is additional monetary loss-of-pay: it comes off the
  // pre-ESI salary and can't push it below zero.
  const penalty = Math.max(0, Math.min(args.penaltyBeforeStatutory ?? 0, grossAfterLop));
  const salaryBeforeEsi = round2(grossAfterLop - penalty);
  // Basic tracks the same retained fraction of gross (LOP + penalty), so PF
  // recomputes on the reduced basic. With no penalty this equals
  // basic × daysAttended/wd, leaving the pre-existing behaviour unchanged.
  const retainedFraction = gross > 0 ? salaryBeforeEsi / gross : 0;
  const basicAfterLop = round2(args.basic * retainedFraction);

  // ESI applies only when the structure flag is on AND gross is within the
  // statutory ₹21,000/month ceiling. Enforcing the ceiling here — not just
  // trusting the saved flag — means a stale/incorrect esiApplicable=true on a
  // high earner's structure can never wrongly deduct ESI. (e.g. Devika &
  // Shibin Raj, whose Jan-2026 structures carried esiApplicable=true despite
  // ₹1.5L+ gross, so the Apr-2026 run wrongly deducted ESI.)
  const esiApplies = args.esiApplicable && isEsiApplicable(gross);
  const esiEmployee = esiApplies ? round(salaryBeforeEsi * ESI_EMPLOYEE_RATE) : 0;
  const esiEmployer = esiApplies ? round(salaryBeforeEsi * ESI_EMPLOYER_RATE) : 0;
  // PF: eligible wage × rate under the effective-dated statutory rule(s)
  // covering this payroll window — prorated per rule segment when the window
  // straddles a rule boundary (e.g. the 17 Sep 2026 ceiling change). The
  // familiar caps (₹1,800 / ₹3,000) fall out of the ceiling; they are never
  // hard-coded amounts. See src/lib/hr-pf.ts.
  const pfConf = args.pf ?? {
    // Legacy single-rule month: identical to the old min(basic, ₹15,000) × 12%.
    segments: [
      { rule: LEGACY_PF_RULE, from: new Date(0), to: new Date(0), days: 1 },
    ],
    totalDays: 1,
    basis: "ceiling" as PfBasis,
    voluntaryPct: null,
  };
  const pf = args.pfApplicable
    ? computePf({
        monthlyPfWage: basicAfterLop,
        basis: pfConf.basis,
        voluntaryPct: pfConf.voluntaryPct,
        segments: pfConf.segments,
        totalDays: pfConf.totalDays,
        epsApplicable: !args.epsExempt,
      })
    : computePf({ monthlyPfWage: 0, basis: pfConf.basis, segments: [], totalDays: 0 });
  const pfEmployee = pf.employeeTotal;
  const pfEmployer = pf.employerTotal;
  const pt = args.professionalTax;

  const netSalary = round(salaryBeforeEsi - esiEmployee - pfEmployee - pt);

  return {
    ...breakdown,
    totalWorkingDays: wd,
    daysAttended,
    // Paid leave = explicit paid leave (full-day LV + paid half-days at 0.5) +
    // loss-of-pay covered by the monthly paid-leave allocation this cycle.
    // Absence / half-day counts stay raw (what actually happened);
    // totalLeaveForLop is the net deduction after cover.
    paidLeave: round2(paidLeaveDays + lopCover),
    unpaidLeave: round2(args.daysAbsent + paidUncovered),
    halfDayLeave: round2(args.daysHalfDay),
    totalLeaveForLop,
    monthlySalary: gross,
    basicSalary: breakdown.basic,
    basicAfterLop,
    dailyBasis,
    penalty,
    salaryBeforeEsi,
    esiEmployee,
    esiEmployer,
    pfEmployee,
    pfEmployer,
    professionalTax: pt,
    netSalary,
    esiTotal: esiEmployee + esiEmployer,
    pfTotal: pfEmployee + pfEmployer,
    pfWage: pf.pfWage,
    pfEmployerEpf: pf.employerEpf,
    pfEmployerEps: pf.employerEps,
    pfEmployeeStatutory: pf.employeePf,
    pfEmployeeVpf: pf.employeeVpf,
    pfBasisApplied: pf.basisApplied,
    pfCeilingApplied: pf.ceilingApplied,
    pfSegments: pf.segments,
  };
}

/**
 * Tally a cycle's attendance rows into the buckets `calcLine` needs.
 *
 * `daysHalfDay` is EVERY half-day (what actually happened, for the payslip).
 * `daysHalfDayPaid` is the subset HR granted as paid leave — those are charged
 * to the leave balance like a full-day LV rather than docked as loss-of-pay, so
 * calcLine has to be able to tell them apart. Half-days with no such decision
 * (null halfPaid — biometric-derived, or HR marked half-day without ruling on
 * pay) are not in it, which is the historical behaviour of every HD row.
 */
export function bucketAttendance(days: { status: string; halfPaid?: boolean | null }[]) {
  let p = 0,
    a = 0,
    hd = 0,
    hdPaid = 0,
    lv = 0;
  for (const d of days) {
    switch (d.status) {
      case "P":
      case "OD":
      case "REG":
        p++;
        break;
      case "A":
        a++;
        break;
      case "HD":
        hd++;
        if (d.halfPaid === true) hdPaid++;
        break;
      case "LV":
        lv++;
        break;
    }
  }
  return {
    daysPresent: p,
    daysAbsent: a,
    daysHalfDay: hd,
    daysHalfDayPaid: hdPaid,
    daysPaidLeave: lv,
  };
}

/**
 * Paid leave the canonical leave engine (hr-leave-balance.ts) counts as "used"
 * for `year` among the given attendance rows, for dates that fall in that
 * calendar year (attendance dates are stored at midnight UTC): a full-day LV at
 * 1.0, and a half-day HR granted as PAID leave at 0.5.
 *
 * A half-day with no pay decision (null halfPaid) is NOT counted — it doesn't
 * consume the leave balance (it's pure 0.5-day loss-of-pay), so there is nothing
 * to add back for it.
 *
 * computeSalaryRun adds this back onto the stored leave balance: that balance is
 * already net of the cycle's own LV (the leave engine subtracts decided leave
 * immediately), so covering this cycle's paid leave against it directly would
 * charge the same days twice — once as the balance deduction, again as LOP. The
 * `year` filter keeps the Dec→Jan cross-year cycle correct: December leave
 * belongs to the previous year's balance, not this one.
 */
export function leaveUsedInYear(
  days: { date: Date; status: string; halfPaid?: boolean | null }[],
  year: number,
): number {
  let used = 0;
  for (const d of days) {
    if (d.date.getUTCFullYear() !== year) continue;
    if (d.status === "LV") used += 1;
    else if (d.status === "HD" && d.halfPaid === true) used += 0.5;
  }
  return round2(used);
}

/**
 * Number of PRESENT days flagged "AL" (Arrived Late beyond grace / LCE quota).
 * Each is docked as a half-day in payroll — being late past the allowance costs
 * 0.5 day. LCE (within the late-coming allowance) is NOT counted. HD days are
 * excluded (they already carry a 0.5 deduction). A regularized/excused day is
 * status REG (not P), so it drops out here → back to full pay.
 */
export function countAlHalfDays(
  days: { id: string; status: string }[],
  tags: Map<string, LateTag>,
): number {
  let n = 0;
  for (const d of days) if (d.status === "P" && tags.get(d.id) === "AL") n++;
  return n;
}

/**
 * Split a set of itemised HrSalaryAdjustment rows into the three ways they move
 * pay. Amounts are stored positive with the direction in `kind`:
 *   - additions       → paid ON TOP of net (incentive, arrears, reimbursement…)
 *   - penaltyTotal    → "penalty"-category deductions, applied PRE-statutory
 *                       (fed to calcLine, which recomputes ESI/PF on the reduced
 *                       salary — see penaltyBeforeStatutory)
 *   - otherDeductions → non-penalty deductions (advance, loan…), taken POST-net
 * `flatNet` = additions − otherDeductions is the post-net adjustment cached on
 * the line as `adjustments`; the penalty is NOT in it (it lives inside the
 * recomputed statutory figures).
 */
export function summarizeAdjustments(rows: { kind: string; category: string; amount: unknown }[]): {
  additions: number;
  penaltyTotal: number;
  otherDeductions: number;
  flatNet: number;
} {
  let additions = 0;
  let penaltyTotal = 0;
  let otherDeductions = 0;
  for (const r of rows) {
    const amt = Number(r.amount);
    if (!Number.isFinite(amt)) continue;
    if (r.kind === "addition") additions += amt;
    else if (r.category === "penalty") penaltyTotal += amt;
    else otherDeductions += amt;
  }
  return {
    additions: round2(additions),
    penaltyTotal: round2(penaltyTotal),
    otherDeductions: round2(otherDeductions),
    flatNet: round2(additions - otherDeductions),
  };
}

/**
 * Calendar days of the cycle `[start, end]` that fall before `joinDate` — the
 * days a mid-cycle joiner was not yet employed and must not be paid for. They
 * usually carry no attendance row at all, and an unmarked day counts as paid
 * (see calcLine), so without this a 1-Sep joiner drew the whole 26-Aug cycle.
 *
 * Dates are date-only at midnight UTC. No join date, or one on/before the cycle
 * start → 0. A join date after the cycle end → every day of the cycle.
 */
export function daysBeforeJoining(joinDate: Date | null | undefined, start: Date, end: Date): number {
  if (!joinDate || joinDate.getTime() <= start.getTime()) return 0;
  const DAY = 86_400_000;
  const lastUnpaid = Math.min(joinDate.getTime() - DAY, end.getTime());
  return Math.round((lastUnpaid - start.getTime()) / DAY) + 1;
}

export async function computeSalaryRun(monthKey: string, userId: string | null): Promise<{
  runId: string;
  lineCount: number;
  warnings: string[];
}> {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error("invalid monthKey");
  // Salary cycle = 26th prev month → 25th current month.
  const { year, start, end } = cycleWindowForMonth(monthKey);
  const workingDaysBase = 30;

  // Statutory PF rules in force during this cycle, selected by PERIOD DATE.
  // A cycle straddling a rule boundary (17 Sep 2026: ₹15,000 → ₹25,000) is
  // split into per-rule segments and prorated by calendar days — both
  // segments combine into the single month's PF on each line.
  const pfRuleRows = await prisma.hrPfRule.findMany({ orderBy: { effectiveFrom: "asc" } });
  const cycleDayTotal = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const { segments: pfSegments, usedFallback: pfFallback } = pfSegmentsForWindow(
    pfRuleRows.map(toPfRule),
    start,
    end,
  );

  const run = await prisma.hrSalaryRun.upsert({
    where: { monthKey },
    update: { status: "draft", workingDaysBase, totalNet: 0 },
    create: {
      monthKey,
      workingDaysBase,
      status: "draft",
      createdById: userId,
    },
  });

  await prisma.hrSalaryRunLine.deleteMany({ where: { runId: run.id } });

  const employees = await prisma.employee.findMany({
    where: { active: true },
    include: { designationRef: true },
  });

  // Ad-hoc, itemised pay corrections entered against this run. Keyed by
  // (run, employee) so they survive the deleteMany above — that is the whole
  // reason they are not attached to the line. Each line's cached `adjustments`
  // (flat, non-penalty) is rebuilt from these below; penalty rows feed calcLine.
  const adjRows = await prisma.hrSalaryAdjustment.findMany({ where: { runId: run.id } });
  const adjByEmployee = new Map<string, typeof adjRows>();
  for (const a of adjRows) {
    const list = adjByEmployee.get(a.employeeId);
    if (list) list.push(a);
    else adjByEmployee.set(a.employeeId, [a]);
  }

  const warnings: string[] = [];
  if (pfFallback) {
    warnings.push(
      `No PF statutory rule covers part of the ${monthKey} cycle — the built-in ₹15,000 ceiling was applied there. Check HR → Salary → Statutory Settings.`,
    );
  }
  let totalNet = 0;
  let lineCount = 0;

  for (const e of employees) {
    const structure = await structureForMonth(e.id, monthKey);
    if (!structure) {
      warnings.push(`No salary structure on file for ${e.empCode} ${e.name} — skipped.`);
      continue;
    }
    // Owners (Managing Director / Director) are paid their full structured
    // salary every month. Attendance and leaves do not apply: no attendance
    // is required and there is never any loss-of-pay. ESI/PF/PT still follow
    // their salary structure as HR sets it.
    const isOwner =
      isOwnerDesignation(effectiveDesignation(e));

    let buckets: {
      daysPresent: number;
      daysAbsent: number;
      daysHalfDay: number;
      daysHalfDayPaid: number;
      daysPaidLeave: number;
    };
    // Present-but-late-beyond-allowance (AL) days are docked as half-days.
    let alHalfDays = 0;
    // Paid-leave days the balance can cover this cycle (passed to calcLine as
    // carriedBalanceBefore; see the per-calendar-year computation below).
    let carried = 0;
    // Loss-of-pay (absence / unpaid half-day / late) covered by the monthly paid-leave
    // allocation this cycle — read from the canonical leave ledger so payroll and
    // the "Paid taken / Unpaid taken" ledger agree exactly.
    let lopCover = 0;
    let preJoin = 0;
    if (isOwner) {
      buckets = { daysPresent: 0, daysAbsent: 0, daysHalfDay: 0, daysHalfDayPaid: 0, daysPaidLeave: 0 };
    } else {
      // Nothing before the join date counts: a holiday / week-off / stray punch
      // row there is not a day of employment. Those days are docked below.
      const from = e.joinDate && e.joinDate > start ? e.joinDate : start;
      const attendance = await prisma.hrAttendanceDay.findMany({
        where: { employeeId: e.id, date: { gte: from, lte: end } },
      });
      if (attendance.length === 0) {
        warnings.push(`No attendance for ${e.empCode} ${e.name} in ${monthKey} — skipped.`);
        continue;
      }
      buckets = bucketAttendance(attendance);
      const { tags } = computeLateTags(attendance, e.halfHourConcession);
      alHalfDays = countAlHalfDays(attendance, tags);

      // Cover this cycle's paid leave — full-day LV at 1.0 plus each half-day
      // granted as paid leave at 0.5 — against the balance as it stood BEFORE
      // the cycle, computed PER CALENDAR YEAR. The canonical leave engine tracks
      // balances by calendar year and deducts decided leave immediately, so we
      // add this cycle's back to recover the pre-cycle balance. A cycle is
      // 26th→25th, so a January run straddles two years (Dec belongs to the
      // previous year's balance) — cover each year's leave against its own
      // balance, else December leave would be charged twice (#Dec→Jan fix).
      const coverYear = async (y: number) => {
        const lv = leaveUsedInYear(attendance, y);
        if (lv === 0) return 0;
        const bal = await prisma.hrLeaveBalance.findUnique({
          where: { employeeId_year: { employeeId: e.id, year: y } },
        });
        const before = (bal ? Number(bal.balance) : 0) + lv; // pre-cycle balance for year y
        return Math.min(lv, Math.max(0, before));
      };
      const startYear = start.getUTCFullYear();
      carried = await coverYear(year);
      if (startYear !== year) carried += await coverYear(startYear);

      // Paid-leave coverage of this cycle's loss-of-pay. The monthly allocation
      // covers the earliest absence / unpaid half-day / late up to the balance
      // available,
      // carried forward month-to-month — exactly what the ledger computes for this
      // cycle month, so payroll matches the "Paid taken / Unpaid taken" ledger.
      const cycleMonthIdx = Number(monthKey.split("-")[1]);
      const ledger = await computeMonthlyLeaveLedger(e.id, year, { asOf: end, fill: "full" });
      lopCover = ledger.rows.find((r) => r.month === cycleMonthIdx)?.covered ?? 0;

      preJoin = daysBeforeJoining(e.joinDate, start, end);
      if (preJoin > 0) {
        warnings.push(
          `${e.empCode} ${e.name} joined ${e.joinDate!.toISOString().slice(0, 10)} — ${preJoin} day(s) before joining docked as loss-of-pay.`,
        );
      }
    }

    // Trainees are paid on BASIC ONLY — the engine forces allowances/ESI/PF/PT
    // to zero by designation name, overriding whatever the saved structure
    // says. Uses the effective designation (relation first, legacy fallback).
    const isTrainee =
      isTraineeDesignation(effectiveDesignation(e));

    // Itemised ad-hoc corrections. The "penalty" slice feeds the pre-statutory
    // calc below (recomputing ESI/PF on the reduced salary); additions and other
    // deductions are the post-net `flatNet` cached on the line as `adjustments`.
    const adj = summarizeAdjustments(adjByEmployee.get(e.id) ?? []);

    const calc = calcLine({
      workingDaysBase,
      basic: Number(structure.basic),
      hraPct: isTrainee ? 0 : Number(structure.hraPct),
      conveyancePct: isTrainee ? 0 : Number(structure.conveyancePct),
      medicalPct: isTrainee ? 0 : Number(structure.medicalPct),
      specialPct: isTrainee ? 0 : Number(structure.specialPct),
      esiApplicable: isTrainee ? false : structure.esiApplicable,
      pfApplicable: isTrainee ? false : structure.pfApplicable,
      professionalTax: isTrainee ? 0 : Number(structure.professionalTax),
      ...buckets,
      // AL (late beyond allowance) present-days are treated as half-days.
      daysHalfDay: buckets.daysHalfDay + alHalfDays,
      daysHalfDayPaid: buckets.daysHalfDayPaid,
      carriedBalanceBefore: carried,
      paidLeaveCoverForLop: lopCover,
      // "penalty"-category deductions reduce the salary before ESI/PF/PT.
      penaltyBeforeStatutory: adj.penaltyTotal,
      daysBeforeJoining: preJoin,
      pf: {
        segments: pfSegments,
        totalDays: cycleDayTotal,
        basis: structure.pfBasis === "actual" ? "actual" : "ceiling",
        voluntaryPct: structure.pfVoluntaryPct == null ? null : Number(structure.pfVoluntaryPct),
      },
      epsExempt: e.epsExempt,
    });

    await prisma.hrSalaryRunLine.create({
      data: {
        runId: run.id,
        employeeId: e.id,
        adjustments: adj.flatNet,
        totalWorkingDays: calc.totalWorkingDays,
        daysAttended: calc.daysAttended,
        paidLeave: calc.paidLeave,
        unpaidLeave: calc.unpaidLeave,
        halfDayLeave: calc.halfDayLeave,
        totalLeaveForLop: calc.totalLeaveForLop,
        monthlySalary: calc.monthlySalary,
        basicSalary: calc.basicSalary,
        basicAfterLop: calc.basicAfterLop,
        dailyBasis: calc.dailyBasis,
        salaryBeforeEsi: calc.salaryBeforeEsi,
        esiEmployee: calc.esiEmployee,
        pfEmployee: calc.pfEmployee,
        professionalTax: calc.professionalTax,
        netSalary: calc.netSalary,
        esiEmployer: calc.esiEmployer,
        pfEmployer: calc.pfEmployer,
        esiTotal: calc.esiTotal,
        pfTotal: calc.pfTotal,
        // PF audit trail — frozen with the line so later statutory changes
        // can never alter what this run deducted (ECR/exports read these).
        pfWage: calc.pfWage,
        pfEmployerEpf: calc.pfEmployerEpf,
        pfEmployerEps: calc.pfEmployerEps,
        pfRuleId: calc.pfSegments.at(-1)?.ruleId ?? null,
        pfRuleCode: calc.pfSegments.at(-1)?.ruleCode ?? null,
        pfBasisApplied: calc.pfBasisApplied,
        pfCeilingApplied: calc.pfCeilingApplied,
        pfDetail: {
          basis: calc.pfBasisApplied,
          ceilingApplied: calc.pfCeilingApplied,
          employeeStatutory: calc.pfEmployeeStatutory,
          employeeVpf: calc.pfEmployeeVpf,
          segments: calc.pfSegments,
        },
        bankAccount: e.accountNumber,
        bankIfsc: e.ifsc,
        bankName: e.bankName,
        bankBranch: e.branch,
      },
    });
    totalNet += calc.netSalary + adj.flatNet;
    lineCount++;
  }

  await prisma.hrSalaryRun.update({
    where: { id: run.id },
    data: { totalNet },
  });

  return { runId: run.id, lineCount, warnings };
}
