import type { EnrollmentDTO } from "@/lib/partner-commissions/server";
import { enrollmentState, invoiceTotal } from "@/lib/partner-commissions/logic";
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

export type PartnerDTO = { id: string; name: string; address: string; email: string | null; forLine: string | null; layout: string; isActive: boolean };
export type ProgramDTO = { code: string; configured: boolean; partnerId: string | null; courseName: string; defaultFee: number | null; defaultPct: number | null; defaultFlat: number | null; isActive: boolean };

export type PcPageData = {
  today: string;
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
