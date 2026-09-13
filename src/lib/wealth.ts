import { prisma } from "./prisma";
import { fromPrismaDate, toPrismaDate, todayIst } from "./lead-pulse-dates";
import { isEncryptedPayload, isSecretVaultConfigured } from "./wealth-crypto";
import { bucketFor, daysUntil, nextDueOn, occurrencesBetween } from "./wealth-reminders";
import type { WealthFrequency } from "./wealth-reminders";
import {
  ASSET_CLASS_META,
  LIABILITY_KINDS,
  STALE_AFTER_MONTHS,
  computeAllocation,
  computeTotals,
  missingLiabilityFields,
  monthsBetween,
  type AssetClassKey,
  type GoldItemRow,
  type HoldingRow,
  type LiabilityKind,
  type LiabilityRow,
  type ReminderRow,
  type WealthSnapshot,
} from "./wealth-model";

/**
 * The Personal Wealth desk — the database side.
 *
 * Shapes and arithmetic live in ./wealth-model, which is free of Prisma and
 * node:crypto so client components can import it. This file is server-only and
 * re-exports the model, so server callers still have one import.
 *
 * Two rules hold everywhere here:
 *
 *  1. Every read and every write is filtered by `ownerUserId`. The page is
 *     admin-gated, but the DATA is owner-gated — a second admin opening
 *     /executive/wealth gets their own empty desk, never someone else's.
 *  2. `portalSecretEnc` is never selected here. Only the dedicated reveal
 *     endpoint reads it, and that writes a WealthSecretReveal row.
 */

export * from "./wealth-model";

function num(d: { toString(): string } | number | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return typeof d === "number" ? d : Number(d.toString());
}

function numOrNull(d: { toString(): string } | number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  return typeof d === "number" ? d : Number(d.toString());
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getWealthSnapshot(ownerUserId: string): Promise<WealthSnapshot> {
  const today = todayIst();

  const [holdingRows, goldRows, liabilityRows, reminderRows, setting] = await Promise.all([
    prisma.wealthHolding.findMany({
      where: { ownerUserId, archivedAt: null },
      // portalSecretEnc is deliberately absent — the list never carries it.
      select: {
        id: true,
        name: true,
        assetClass: true,
        scope: true,
        holderLabel: true,
        institution: true,
        policyNo: true,
        investedAmount: true,
        contributionAmount: true,
        frequency: true,
        dueDayOfMonth: true,
        renewalOn: true,
        termYears: true,
        sumAssured: true,
        reminderLeadDays: true,
        portalUrl: true,
        portalUsername: true,
        notes: true,
        valuations: { orderBy: { asOn: "desc" }, take: 1, select: { asOn: true, value: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.wealthGoldItem.findMany({
      where: { ownerUserId, archivedAt: null },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.wealthLiability.findMany({ where: { ownerUserId }, orderBy: { outstanding: "desc" } }),
    prisma.wealthReminder.findMany({
      where: { ownerUserId },
      orderBy: { dueOn: "asc" },
      include: { holding: { select: { reminderLeadDays: true } } },
    }),
    prisma.wealthSetting.findUnique({ where: { ownerUserId } }),
  ]);

  // Secrets: ask only which holdings have one, so the ciphertext never leaves
  // the database on the page-load path.
  const withSecret = await prisma.wealthHolding.findMany({
    where: { ownerUserId, archivedAt: null, portalSecretEnc: { not: null } },
    select: { id: true, portalSecretEnc: true },
  });
  const secretIds = new Set(
    withSecret.filter((h) => isEncryptedPayload(h.portalSecretEnc)).map((h) => h.id),
  );

  const holdings: HoldingRow[] = holdingRows.map((h) => {
    const latest = h.valuations[0];
    const valuedOn = latest ? fromPrismaDate(latest.asOn) : null;
    const ageMonths = valuedOn ? monthsBetween(valuedOn, today) : null;
    const renewalOn = h.renewalOn ? fromPrismaDate(h.renewalOn) : null;
    const frequency = h.frequency as WealthFrequency;
    return {
      id: h.id,
      name: h.name,
      assetClass:
        (h.assetClass as AssetClassKey) in ASSET_CLASS_META
          ? (h.assetClass as AssetClassKey)
          : "other",
      scope: h.scope === "business" ? "business" : "personal",
      holderLabel: h.holderLabel,
      institution: h.institution,
      policyNo: h.policyNo,
      investedAmount: numOrNull(h.investedAmount),
      contributionAmount: numOrNull(h.contributionAmount),
      frequency,
      dueDayOfMonth: h.dueDayOfMonth,
      renewalOn,
      termYears: h.termYears,
      sumAssured: numOrNull(h.sumAssured),
      reminderLeadDays: h.reminderLeadDays,
      portalUrl: h.portalUrl,
      portalUsername: h.portalUsername,
      hasSecret: secretIds.has(h.id),
      notes: h.notes,
      value: latest ? num(latest.value) : 0,
      valuedOn,
      valuationAgeMonths: ageMonths,
      isStale: ageMonths !== null && ageMonths >= STALE_AFTER_MONTHS,
      nextDueOn: nextDueOn({ frequency, dueDayOfMonth: h.dueDayOfMonth, renewalOn }, today),
    };
  });

  const ratePerGram = num(setting?.goldRatePerGram);
  const goldItems: GoldItemRow[] = goldRows.map((g) => ({
    id: g.id,
    category: g.category,
    name: g.name,
    grams: num(g.grams),
    holderLabel: g.holderLabel,
    purityKarat: g.purityKarat,
    dueOn: g.dueOn ? fromPrismaDate(g.dueOn) : null,
    notes: g.notes,
    value: num(g.grams) * ratePerGram,
  }));
  const totalGrams = goldItems.reduce((s, g) => s + g.grams, 0);

  const byCategoryMap = new Map<string, number>();
  for (const g of goldItems) {
    byCategoryMap.set(g.category, (byCategoryMap.get(g.category) ?? 0) + g.grams);
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([category, grams]) => ({ category, grams, value: grams * ratePerGram }))
    .sort((a, b) => b.grams - a.grams);

  const liabilities: LiabilityRow[] = liabilityRows.map((l) => {
    const row = {
      id: l.id,
      name: l.name,
      kind: (LIABILITY_KINDS as readonly string[]).includes(l.kind)
        ? (l.kind as LiabilityKind)
        : ("other" as LiabilityKind),
      scope: l.scope === "business" ? ("business" as const) : ("personal" as const),
      lender: l.lender,
      principal: numOrNull(l.principal),
      outstanding: num(l.outstanding),
      interestRate: numOrNull(l.interestRate),
      emiAmount: numOrNull(l.emiAmount),
      emiDayOfMonth: l.emiDayOfMonth,
      startedOn: l.startedOn ? fromPrismaDate(l.startedOn) : null,
      tenureMonths: l.tenureMonths,
      notes: l.notes,
      isClosed: l.closedAt !== null,
    };
    return { ...row, missingFields: missingLiabilityFields(row) };
  });

  const reminders: ReminderRow[] = reminderRows.map((r) => {
    const dueOn = fromPrismaDate(r.dueOn);
    const leadDays = r.holding?.reminderLeadDays ?? 7;
    return {
      id: r.id,
      label: r.label,
      kind: r.kind,
      dueOn,
      amount: numOrNull(r.amount),
      status: r.status,
      paidOn: r.paidOn ? fromPrismaDate(r.paidOn) : null,
      holdingId: r.holdingId,
      liabilityId: r.liabilityId,
      leadDays,
      bucket: bucketFor(dueOn, leadDays, today),
      daysUntil: daysUntil(dueOn, today),
    };
  });

  const goldValue = totalGrams * ratePerGram;

  return {
    today,
    holdings,
    gold: {
      items: goldItems,
      totalGrams,
      ratePerGram,
      rateAsOn: setting?.goldRateAsOn ? fromPrismaDate(setting.goldRateAsOn) : null,
      value: goldValue,
      byCategory,
    },
    liabilities,
    reminders,
    settings: {
      goldRatePerGram: ratePerGram,
      goldRateAsOn: setting?.goldRateAsOn ? fromPrismaDate(setting.goldRateAsOn) : null,
      hideBusinessScope: setting?.hideBusinessScope ?? false,
      remindersEnabled: setting?.remindersEnabled ?? true,
    },
    totals: computeTotals({ holdings, goldValue, liabilities, reminders, today }),
    allocation: computeAllocation(holdings, goldValue),
    secretVaultConfigured: isSecretVaultConfigured(),
    isEmpty: holdings.length === 0 && goldItems.length === 0 && liabilities.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Reminder generation
// ---------------------------------------------------------------------------

/**
 * Project every holding's schedule forward and make sure a WealthReminder row
 * exists for each occurrence inside the horizon.
 *
 * Idempotent by construction: the (holdingId, dueOn, kind) unique key means
 * re-running creates nothing new, so this is safe to call on every page load
 * and from the daily cron. Existing rows are never touched — a reminder the
 * owner has already marked paid stays paid.
 */
export async function syncReminders(ownerUserId: string, horizonMonths = 12): Promise<number> {
  const today = todayIst();
  const until = addMonthsKey(today, horizonMonths);

  const [holdings, liabilities] = await Promise.all([
    prisma.wealthHolding.findMany({
      where: { ownerUserId, archivedAt: null },
      select: {
        id: true,
        name: true,
        assetClass: true,
        frequency: true,
        dueDayOfMonth: true,
        renewalOn: true,
        contributionAmount: true,
      },
    }),
    prisma.wealthLiability.findMany({
      where: { ownerUserId, closedAt: null, emiDayOfMonth: { not: null } },
      select: { id: true, name: true, emiDayOfMonth: true, emiAmount: true },
    }),
  ]);

  type Pending = {
    ownerUserId: string;
    holdingId: string | null;
    liabilityId: string | null;
    label: string;
    kind: string;
    dueOn: Date;
    amount: number | null;
  };
  const pending: Pending[] = [];

  for (const h of holdings) {
    const frequency = h.frequency as WealthFrequency;
    const schedule = {
      frequency,
      dueDayOfMonth: h.dueDayOfMonth,
      renewalOn: h.renewalOn ? fromPrismaDate(h.renewalOn) : null,
    };
    const kind = reminderKindFor(frequency, h.assetClass);
    for (const dueOn of occurrencesBetween(schedule, today, until)) {
      pending.push({
        ownerUserId,
        holdingId: h.id,
        liabilityId: null,
        label: h.name,
        kind,
        dueOn: toPrismaDate(dueOn),
        amount: numOrNull(h.contributionAmount),
      });
    }
  }

  for (const l of liabilities) {
    const schedule = { frequency: "monthly" as const, dueDayOfMonth: l.emiDayOfMonth };
    for (const dueOn of occurrencesBetween(schedule, today, until)) {
      pending.push({
        ownerUserId,
        holdingId: null,
        liabilityId: l.id,
        label: `${l.name} — EMI`,
        kind: "emi",
        dueOn: toPrismaDate(dueOn),
        amount: numOrNull(l.emiAmount),
      });
    }
  }

  if (pending.length === 0) return 0;
  const res = await prisma.wealthReminder.createMany({ data: pending, skipDuplicates: true });
  return res.count;
}

function reminderKindFor(frequency: WealthFrequency, assetClass: string): string {
  if (assetClass === "protection" || assetClass === "insurance") {
    return frequency === "monthly" ? "premium" : "renewal";
  }
  if (assetClass === "savings") return "deposit";
  if (frequency === "monthly" || frequency === "quarterly") return "sip";
  return "renewal";
}

function addMonthsKey(key: string, months: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Ensure a settings row exists so the gold rate always has a home. */
export async function ensureWealthSetting(ownerUserId: string) {
  return prisma.wealthSetting.upsert({
    where: { ownerUserId },
    create: { ownerUserId },
    update: {},
  });
}
