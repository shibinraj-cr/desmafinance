import type { EnrollmentDTO } from "@/lib/partner-commissions/server";
import { assignVolume, commissionOf, enrollmentState, invoiceTotal, volumeFyMonths, volumeFyOf, type VolumeAssignment, type VolumeTier } from "@/lib/partner-commissions/logic";
import type { EnrollmentState } from "@/lib/partner-commissions/constants";

export type { EnrollmentDTO };

export type InvoiceLineDTO = {
  id: string;
  enrollmentId: string | null;
  program: string;
  description: string;
  studentId: string | null;
  courseName: string;
  intakeMonth: string;
  courseFee: number;
  commissionPct: number;
  /** Set when the line is a flat commission (printed as "Flat"). */
  commissionFlat: number | null;
  amount: number;
  /** Volume bonus included in commissionPct, and the enrollment's place in that financial year. */
  volumeBonusPct: number | null;
  volumeSeq: number | null;
  volumeFy: string | null;
};

export type ReceiptDTO = {
  id: string;
  receivedOn: string;
  audSettled: number;
  aedAmount: number;
  inrAmount: number;
  aedInrRate: number;
  reference: string | null;
  settleInFull: boolean;
  skipLedger: boolean;
  status: string;
  recordedBy: string | null;
  recordedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  posted: number;
};

export type InvoiceDTO = {
  id: string;
  number: string;
  partnerId: string;
  layout: string;
  invoiceDate: string;
  paymentTerm: string;
  currency: string;
  billToName: string;
  billToAddress: string;
  billToEmail: string | null;
  billToFor: string | null;
  amountWords: string | null;
  status: string;
  source: string;
  sentAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  createdBy: string | null;
  lines: InvoiceLineDTO[];
  receipts: ReceiptDTO[];
};

export type SettingsDTO = {
  issuerName: string;
  issuerAddress: string;
  issuerRegLine: string;
  bankAccountName: string;
  bankCurrency: string;
  bankIban: string;
  bankBic: string;
  bankAccountNo: string;
  signatoryName: string;
  hasSignature: boolean;
  numberPrefix: string;
  /** Lowest number DesGro may suggest in its financial year (invoices raised outside DesGro share the series). */
  nextNumber: string | null;
  runDay: number;
  emailAlerts: boolean;
  bdePrograms: string[];
};

export type PartnerDTO = {
  id: string;
  name: string;
  address: string;
  email: string | null;
  forLine: string | null;
  layout: string;
  isActive: boolean;
  volumeTiers: VolumeTier[];
  /** Enrollments billed outside DesGro, per financial year. */
  volumeOpening: Record<string, number>;
};
export type ProgramDTO = { code: string; configured: boolean; partnerId: string | null; courseName: string; defaultFee: number | null; defaultPct: number | null; defaultFlat: number | null; installmentPlans: number[]; isActive: boolean };

export type PcPageData = {
  today: string;
  /** The next number in the shared D/DLLC series today (candidate invoices included), as the server would pick it. */
  suggestedNumber: string;
  userId: string;
  canApprove: boolean;
  settings: SettingsDTO;
  partners: PartnerDTO[];
  programs: ProgramDTO[];
  enrollments: EnrollmentDTO[];
  invoices: InvoiceDTO[];
  run: { ranThisMonth: boolean; nextRun: string; lastRunAt: string | null; lastRunCount: number };
  grants: Array<{ userId: string; username: string; programs: string[] }>;
  users: Array<{ id: string; username: string }>;
  bdeCount: number;
};

export function stateOf(e: EnrollmentDTO): EnrollmentState {
  return enrollmentState({ status: e.status, courseFee: e.courseFee, payments: e.payments, invoiceStatus: e.invoice?.status ?? null });
}

export const totalOf = (inv: InvoiceDTO) => invoiceTotal(inv.lines);
export const approvedAud = (inv: InvoiceDTO) => inv.receipts.filter((r) => r.status === "approved").reduce((s, r) => s + r.audSettled, 0);

/** Setup gaps that would print a half-empty invoice. */
export function setupGaps(s: SettingsDTO, partners: PartnerDTO[], programs: ProgramDTO[]): string[] {
  const gaps: string[] = [];
  if (partners.length === 0) gaps.push("add the partners");
  if (programs.some((p) => !p.configured)) gaps.push(`set up ${programs.filter((p) => !p.configured).map((p) => p.code).join(", ")}`);
  if (!s.issuerName) gaps.push("fill in the invoice issuer");
  if (!s.bankIban && !s.bankAccountNo) gaps.push("add the bank account");
  if (!s.signatoryName) gaps.push("name the signatory");
  return gaps;
}

/** Enrollments of a partner already on a DesGro invoice, for one financial year. */
export function billedInFy(enrollments: EnrollmentDTO[], partnerId: string, fy: string): number {
  const months = new Set(volumeFyMonths(fy));
  return enrollments.filter((e) => e.partnerId === partnerId && e.invoice && months.has(e.intakeMonth)).length;
}

/**
 * The volume numbers and bonus these enrollments would get if billed now, in
 * this order — the same rule the server applies when it drafts the invoice.
 */
export function projectVolume(data: PcPageData, partnerId: string, items: EnrollmentDTO[]): Map<string, VolumeAssignment> {
  const partner = data.partners.find((p) => p.id === partnerId);
  if (!partner || partner.volumeTiers.length === 0) return new Map();
  // The server bills in this order (fully paid date, then name).
  items = [...items].sort((a, b) => (a.fullyPaidOn ?? "").localeCompare(b.fullyPaidOn ?? "") || (a.candidateName < b.candidateName ? -1 : a.candidateName > b.candidateName ? 1 : 0));
  const ids = new Set(items.map((i) => i.id));
  const others = data.enrollments.filter((e) => !ids.has(e.id));
  const billed: Record<string, number> = {};
  for (const fy of new Set(items.map((i) => volumeFyOf(i.intakeMonth)).filter((x): x is string => !!x))) billed[fy] = billedInFy(others, partnerId, fy);
  return assignVolume({
    tiers: partner.volumeTiers,
    opening: partner.volumeOpening,
    billed,
    items: items.map((i) => ({ id: i.id, intakeMonth: i.intakeMonth, flat: i.commissionFlat != null })),
  });
}

export type CommissionView = { amount: number; pct: number; flat: number | null; bonus: number; seq: number | null; fy: string | null; billed: boolean };

/**
 * What each enrollment is billed at (its invoice line), or would be if billed
 * now (its own rate plus any projected volume bonus while it waits fully
 * paid), else its own rate.
 */
export function commissionViews(data: PcPageData): Map<string, CommissionView> {
  const out = new Map<string, CommissionView>();
  const lineByEnrollment = new Map<string, InvoiceLineDTO>();
  for (const inv of data.invoices) {
    if (inv.status === "cancelled") continue;
    for (const l of inv.lines) if (l.enrollmentId) lineByEnrollment.set(`${inv.id}:${l.enrollmentId}`, l);
  }
  const queued = data.enrollments.filter((e) => stateOf(e) === "fullypaid");
  const projected = new Map<string, VolumeAssignment>();
  for (const pid of new Set(queued.map((e) => e.partnerId))) {
    for (const [id, v] of projectVolume(data, pid, queued.filter((e) => e.partnerId === pid))) projected.set(id, v);
  }
  for (const e of data.enrollments) {
    const line = e.invoice ? lineByEnrollment.get(`${e.invoice.id}:${e.id}`) : undefined;
    if (line) {
      out.set(e.id, { amount: line.amount, pct: line.commissionPct, flat: line.commissionFlat, bonus: line.volumeBonusPct ?? 0, seq: line.volumeSeq, fy: line.volumeFy, billed: true });
      continue;
    }
    const v = projected.get(e.id);
    const pct = e.commissionPct + (v?.extraPct ?? 0);
    out.set(e.id, { amount: commissionOf(e.courseFee, pct, e.commissionFlat), pct, flat: e.commissionFlat, bonus: v?.extraPct ?? 0, seq: v?.seq ?? null, fy: v?.fy ?? null, billed: false });
  }
  return out;
}
