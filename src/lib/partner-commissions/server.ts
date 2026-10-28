import { Prisma, type CommissionSettings } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage } from "@/lib/rbac";
import { verifyCategorySubItem } from "@/lib/master-data";
import { flowFor, monthCodeFromDate } from "@/lib/catalog";
import { todayIst } from "@/lib/lead-pulse-dates";
import { badRequest, conflict, forbidden, notFound, unauthorized, unprocessable } from "@/lib/http-error";
import {
  LEDGER,
  MAX_INSTALLMENTS,
  PC_FINANCE_PAGE,
  PC_NOTIFY_KIND,
  PROGRAM_CODES,
  isProgramCode,
  type ProgramCode,
} from "./constants";
import {
  balanceOf,
  checkInstallment,
  commissionOf,
  defaultLineDescription,
  enrollablePrograms,
  fullyPaidOn,
  invoiceTotal,
  isEditableInvoice,
  isIntakeMonth,
  planLabel,
  canTrackEnrollment,
  looksLikeSeries,
  openAud,
  round2,
  runDue,
  splitByProgram,
  statusAfterApproval,
  statusAfterReturn,
  suggestInvoiceNumber,
} from "./logic";

/**
 * Server half of Partner Commissions: who may do what, and every database write.
 * Route handlers stay thin — they parse input and call one function here.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d.toString()));
export const isoDate = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// ── settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<CommissionSettings> {
  const s = await prisma.commissionSettings.findUnique({ where: { id: "default" } });
  if (s) return s;
  try {
    return await prisma.commissionSettings.create({ data: { id: "default" } });
  } catch (e) {
    // Two first requests raced to create it; the other one won.
    if (isUniqueViolation(e)) return prisma.commissionSettings.findUniqueOrThrow({ where: { id: "default" } });
    throw e;
  }
}

// ── access ───────────────────────────────────────────────────────────────────

export type PcAccess = {
  userId: string;
  /** Anyone with the Finance page: enrollments, installments, invoices, payments. */
  isFinance: boolean;
  /** Finance + a role that can approve: approves payments and edits settings. */
  canApprove: boolean;
  isBde: boolean;
  /** Programs this person may ADD enrollments for. */
  programs: ProgramCode[];
  /** Programs from a personal grant — every enrollment in them can be tracked. */
  grantPrograms: ProgramCode[];
  /** Programs opened to BDEs, when this person is an active BDE (else empty). */
  bdePrograms: ProgramCode[];
};

export async function getAccess(): Promise<PcAccess | null> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return null;
  const isFinance = canSeePage(perms, PC_FINANCE_PAGE);
  const [lp, grant, settings] = await Promise.all([
    prisma.leadPulseRole.findUnique({ where: { userId }, select: { role: true, active: true } }),
    prisma.commissionEnrollGrant.findUnique({ where: { userId }, select: { programs: true } }),
    getSettings(),
  ]);
  const isBde = !!lp?.active && (lp.role === "l1" || lp.role === "l2");
  const programs = enrollablePrograms({
    isFinance,
    isBde,
    bdePrograms: settings.bdePrograms,
    grantPrograms: grant?.programs ?? [],
    allPrograms: PROGRAM_CODES,
  }) as ProgramCode[];
  return {
    userId,
    isFinance,
    canApprove: isFinance && (perms.isAdmin || perms.canApprove),
    isBde,
    programs,
    grantPrograms: (grant?.programs ?? []).filter(isProgramCode),
    bdePrograms: isBde ? settings.bdePrograms.filter(isProgramCode) : [],
  };
}

export async function requireAccess(need: "any" | "finance" | "approve"): Promise<PcAccess> {
  const a = await getAccess();
  if (!a) throw unauthorized();
  if (need === "finance" && !a.isFinance) throw forbidden();
  if (need === "approve" && !a.canApprove) throw forbidden("Only a Finance Manager or Admin can do this.");
  if (need === "any" && !a.isFinance && a.programs.length === 0) throw forbidden();
  return a;
}

// ── enrollments ──────────────────────────────────────────────────────────────

export type EnrollmentInput = {
  program: string;
  candidateName: string;
  leadId?: string | null;
  studentId?: string | null;
  courseName?: string | null;
  intakeMonth: string;
  courseFee: number;
  commissionPct?: number | null;
  /** Finance only: a flat AUD commission (null = use the percentage). Omitted = the program's default. */
  commissionFlat?: number | null;
  notes?: string | null;
  firstPayment?: { amount: number; paidOn: string; reference?: string | null } | null;
  /** The installment plan picked when enrolling — required when the program offers plans (GCAN: 1, 2 or 6). */
  installmentPlan?: number | null;
};

async function programConfig(code: string) {
  const p = await prisma.commissionProgram.findUnique({ where: { code }, include: { partner: true } });
  if (!p || !p.isActive || !p.partner.isActive) {
    throw unprocessable(`${code} isn't set up yet. A Finance Manager adds its partner on the Settings tab.`, "program_not_set_up");
  }
  return p;
}

function checkFee(fee: number) {
  if (!(fee > 0) || fee > 1_000_000) throw badRequest("Enter the total course fee in AUD.");
}
function checkPct(pct: number) {
  if (!(pct >= 0 && pct <= 100)) throw badRequest("Commission % must be between 0 and 100.");
}
function checkFlat(flat: number) {
  if (!(flat > 0) || flat > 1_000_000) throw badRequest("Enter the flat commission in AUD.");
}
const flatOf = (d: Prisma.Decimal | null | undefined): number | null => (d == null ? null : num(d));

export async function createEnrollment(a: PcAccess, input: EnrollmentInput) {
  if (!isProgramCode(input.program)) throw badRequest("Pick NCLEX, OSCE or GCAN.");
  if (!a.programs.includes(input.program)) throw forbidden(`You can't add ${input.program} enrollments.`);
  const name = input.candidateName.trim();
  if (name.length < 2 || name.length > 120) throw badRequest("Enter the candidate's name.");
  if (!isIntakeMonth(input.intakeMonth)) throw badRequest("Pick the intake month.");
  checkFee(input.courseFee);
  const prog = await programConfig(input.program);
  // Only Finance sets the commission and the course name; everyone else gets the program's defaults.
  // A program pays either a flat amount (e.g. GCAN) or a percentage of the course fee.
  const flat = a.isFinance && input.commissionFlat !== undefined ? input.commissionFlat : flatOf(prog.defaultFlat);
  const pct = a.isFinance && input.commissionPct != null ? input.commissionPct : num(prog.defaultPct);
  if (flat != null) checkFlat(flat);
  else checkPct(pct);
  if (!a.isFinance && prog.defaultPct == null && prog.defaultFlat == null) {
    throw unprocessable(`${input.program}'s commission isn't set yet. Ask Finance to set it in Settings.`, "program_not_set_up");
  }
  if (input.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: input.leadId }, select: { id: true } });
    if (!lead) throw badRequest("That CRM lead no longer exists.");
  }
  // Whoever adds the enrollment may record a 1st installment already paid — they track this candidate's fee.
  const first = input.firstPayment ?? null;
  const plan = choosePlan(input.program, prog.installmentPlans, input.installmentPlan ?? null);
  const today = todayIst();
  if (first) {
    const err = checkInstallment({ courseFee: input.courseFee, payments: [], amount: first.amount, paidOn: first.paidOn, today, plan });
    if (err) throw badRequest(err);
  }
  const created = await prisma.commissionEnrollment.create({
    data: {
      program: input.program,
      partnerId: prog.partnerId,
      candidateName: name,
      leadId: input.leadId || null,
      studentId: clean(input.studentId),
      courseName: (a.isFinance && clean(input.courseName)) || prog.courseName,
      intakeMonth: input.intakeMonth,
      courseFee: round2(input.courseFee),
      commissionPct: pct,
      commissionFlat: flat,
      installmentPlan: plan,
      notes: clean(input.notes),
      createdById: a.userId,
      fullyPaidOn: first && round2(first.amount) === round2(input.courseFee) ? toDate(first.paidOn) : null,
      payments: first
        ? { create: { seq: 1, amount: round2(first.amount), paidOn: toDate(first.paidOn), reference: clean(first.reference), createdById: a.userId } }
        : undefined,
    },
  });
  await recordAudit({ entityType: "CommissionEnrollment", entityId: created.id, action: "CREATE", userId: a.userId, changes: { ...input } });
  return created;
}

async function loadEnrollment(id: string) {
  const e = await prisma.commissionEnrollment.findUnique({
    where: { id },
    include: { payments: { orderBy: { seq: "asc" } }, invoice: { select: { status: true } }, lead: { select: { assignedToId: true } } },
  });
  if (!e) throw notFound("That enrollment no longer exists.");
  return e;
}

/** Record/undo installments: Finance, the program's coordinator, or the BDE whose candidate it is. */
function assertCanTrack(a: PcAccess, e: { program: string; createdById: string | null; lead: { assignedToId: string | null } | null }) {
  const ok = canTrackEnrollment(a, { program: e.program, createdById: e.createdById, leadAssignedToId: e.lead?.assignedToId ?? null });
  if (!ok) throw forbidden("You can record installments only for enrollments you added or whose CRM lead is assigned to you.");
}

/**
 * The enrollments a person sees on Partner Enrollments — exactly the ones they
 * may record installments for (canTrackEnrollment), plus any they added.
 */
export function trackableWhere(a: PcAccess): Prisma.CommissionEnrollmentWhereInput {
  if (a.isFinance) return {};
  const or: Prisma.CommissionEnrollmentWhereInput[] = [{ createdById: a.userId }];
  if (a.grantPrograms.length) or.push({ program: { in: a.grantPrograms } });
  if (a.bdePrograms.length) or.push({ program: { in: a.bdePrograms }, lead: { assignedToId: a.userId } });
  return { OR: or };
}

/** Recompute fullyPaidOn after the fee or the payments changed. */
async function syncFullyPaid(id: string) {
  const e = await loadEnrollment(id);
  const fp = fullyPaidOn(
    num(e.courseFee),
    e.payments.map((p) => ({ amount: num(p.amount), paidOn: isoDate(p.paidOn)! })),
  );
  await prisma.commissionEnrollment.update({ where: { id }, data: { fullyPaidOn: fp ? toDate(fp) : null } });
}

export type EnrollmentPatch = {
  candidateName?: string;
  studentId?: string | null;
  intakeMonth?: string;
  courseFee?: number;
  commissionPct?: number;
  /** Finance only: a flat AUD commission, or null to go back to the percentage. */
  commissionFlat?: number | null;
  courseName?: string;
  leadId?: string | null;
  notes?: string | null;
};

export async function updateEnrollment(a: PcAccess, id: string, patch: EnrollmentPatch) {
  const e = await loadEnrollment(id);
  if (e.invoiceId) throw conflict("This enrollment is on an invoice. Change it on the invoice, or remove it from the invoice first.");
  if (e.status === "withdrawn") throw conflict("This enrollment is withdrawn.");
  // Outside Finance: only your own enrollment, and only until the first payment is recorded.
  if (!a.isFinance) {
    if (e.createdById !== a.userId) throw forbidden("You can only edit enrollments you added.");
    if (e.payments.length > 0) throw conflict("Installments are recorded against it now, so ask Finance to change it.");
    if (patch.commissionPct !== undefined || patch.commissionFlat !== undefined || patch.courseName !== undefined) throw forbidden();
  }
  const data: Prisma.CommissionEnrollmentUpdateInput = {};
  if (patch.candidateName !== undefined) {
    const n = patch.candidateName.trim();
    if (n.length < 2 || n.length > 120) throw badRequest("Enter the candidate's name.");
    data.candidateName = n;
  }
  if (patch.studentId !== undefined) data.studentId = clean(patch.studentId);
  if (patch.intakeMonth !== undefined) {
    if (!isIntakeMonth(patch.intakeMonth)) throw badRequest("Pick the intake month.");
    data.intakeMonth = patch.intakeMonth;
  }
  if (patch.courseFee !== undefined) {
    checkFee(patch.courseFee);
    const paid = e.payments.reduce((s, p) => s + num(p.amount), 0);
    if (round2(patch.courseFee) < round2(paid)) throw badRequest(`The fee can't be below the AUD ${paid} already paid.`);
    data.courseFee = round2(patch.courseFee);
  }
  if (patch.commissionPct !== undefined) {
    checkPct(patch.commissionPct);
    data.commissionPct = patch.commissionPct;
  }
  if (patch.commissionFlat !== undefined) {
    if (patch.commissionFlat != null) checkFlat(patch.commissionFlat);
    data.commissionFlat = patch.commissionFlat;
  }
  if (patch.courseName !== undefined) {
    const c = patch.courseName.trim();
    if (!c) throw badRequest("Enter the course name.");
    data.courseName = c;
  }
  if (patch.leadId !== undefined) {
    if (patch.leadId) {
      const lead = await prisma.lead.findUnique({ where: { id: patch.leadId }, select: { id: true } });
      if (!lead) throw badRequest("That CRM lead no longer exists.");
      data.lead = { connect: { id: patch.leadId } };
    } else data.lead = { disconnect: true };
  }
  if (patch.notes !== undefined) data.notes = clean(patch.notes);
  await prisma.commissionEnrollment.update({ where: { id }, data });
  if (patch.courseFee !== undefined) await syncFullyPaid(id);
  await recordAudit({ entityType: "CommissionEnrollment", entityId: id, action: "UPDATE", userId: a.userId, changes: { ...patch } });
}

export async function addFeePayment(a: PcAccess, id: string, p: { amount: number; paidOn: string; reference?: string | null }) {
  const e = await loadEnrollment(id);
  assertCanTrack(a, e);
  if (e.status === "withdrawn") throw conflict("This enrollment is withdrawn.");
  if (e.invoiceId) throw conflict("This enrollment is already invoiced.");
  const payments = e.payments.map((x) => ({ amount: num(x.amount) }));
  const err = checkInstallment({ courseFee: num(e.courseFee), payments, amount: p.amount, paidOn: p.paidOn, today: todayIst(), plan: e.installmentPlan });
  if (err) throw badRequest(err);
  const seq = e.payments.length + 1;
  try {
    await prisma.commissionFeePayment.create({
      data: { enrollmentId: id, seq, amount: round2(p.amount), paidOn: toDate(p.paidOn), reference: clean(p.reference), createdById: a.userId },
    });
  } catch (e2) {
    if (isUniqueViolation(e2)) throw conflict("Someone just recorded this installment. Reload to see it.");
    throw e2;
  }
  await syncFullyPaid(id);
  await recordAudit({ entityType: "CommissionEnrollment", entityId: id, action: "UPDATE", userId: a.userId, changes: { feePayment: { seq, ...p } } });
}

export async function undoLastFeePayment(a: PcAccess, id: string) {
  const e = await loadEnrollment(id);
  assertCanTrack(a, e);
  if (e.invoiceId) throw conflict("This enrollment is already invoiced.");
  const last = e.payments[e.payments.length - 1];
  if (!last) throw conflict("There's no installment to undo.");
  await prisma.commissionFeePayment.delete({ where: { id: last.id } });
  await syncFullyPaid(id);
  await recordAudit({
    entityType: "CommissionEnrollment",
    entityId: id,
    action: "UPDATE",
    userId: a.userId,
    changes: { undoFeePayment: { seq: last.seq, amount: num(last.amount), paidOn: isoDate(last.paidOn) } },
  });
}

/**
 * The plan for a new enrollment: required and one of the offered plans when the
 * program has plans (GCAN: 1, 2 or 6); none otherwise.
 */
function choosePlan(program: string, offered: number[], picked: number | null): number | null {
  if (offered.length === 0) return null;
  if (picked == null || !offered.includes(picked)) {
    throw badRequest(`Pick ${program}'s installment plan: ${offered.map(planLabel).join(", ")}.`);
  }
  return picked;
}

/**
 * Change an enrollment's installment plan (e.g. 2 → 6 when the candidate needs
 * longer). Anyone who records its installments may, until it is invoiced; the
 * plan can't drop below the installments already recorded.
 */
export async function setInstallmentPlan(a: PcAccess, id: string, plan: number) {
  const e = await loadEnrollment(id);
  assertCanTrack(a, e);
  if (e.invoiceId) throw conflict("This enrollment is already invoiced.");
  if (e.status === "withdrawn") throw conflict("This enrollment is withdrawn.");
  const prog = await prisma.commissionProgram.findUnique({ where: { code: e.program }, select: { installmentPlans: true } });
  const offered = prog?.installmentPlans ?? [];
  if (offered.length ? !offered.includes(plan) : !(Number.isInteger(plan) && plan >= 1 && plan <= MAX_INSTALLMENTS)) {
    throw badRequest(offered.length ? `Pick one of ${e.program}'s plans: ${offered.map(planLabel).join(", ")}.` : "Pick a plan of 1 to 6 installments.");
  }
  if (plan < e.payments.length) throw badRequest(`${e.payments.length} installments are already recorded, so the plan can't be ${plan}.`);
  await prisma.commissionEnrollment.update({ where: { id }, data: { installmentPlan: plan } });
  await recordAudit({ entityType: "CommissionEnrollment", entityId: id, action: "UPDATE", userId: a.userId, changes: { installmentPlan: { from: e.installmentPlan, to: plan } } });
}

export async function setWithdrawn(a: PcAccess, id: string, withdrawn: boolean) {
  if (!a.isFinance) throw forbidden();
  const e = await loadEnrollment(id);
  if (e.invoiceId) throw conflict("This enrollment is on an invoice. Remove it from the invoice first.");
  await prisma.commissionEnrollment.update({ where: { id }, data: { status: withdrawn ? "withdrawn" : "active" } });
  await recordAudit({ entityType: "CommissionEnrollment", entityId: id, action: "UPDATE", userId: a.userId, changes: { status: withdrawn ? "withdrawn" : "active" } });
}

export async function deleteEnrollment(a: PcAccess, id: string) {
  const e = await loadEnrollment(id);
  if (e.invoiceId) throw conflict("This enrollment is on an invoice.");
  if (e.payments.length > 0) throw conflict("Payments are recorded against it. Mark it withdrawn instead.");
  if (!a.isFinance && e.createdById !== a.userId) throw forbidden("You can only delete enrollments you added.");
  const lines = await prisma.commissionInvoiceLine.count({ where: { enrollmentId: id } });
  if (lines > 0) throw conflict("It appears on a cancelled invoice, so it's kept for the record. Mark it withdrawn instead.");
  await prisma.commissionEnrollment.delete({ where: { id } });
  await recordAudit({ entityType: "CommissionEnrollment", entityId: id, action: "DELETE", userId: a.userId, changes: { candidateName: e.candidateName, program: e.program } });
}

// ── invoices ─────────────────────────────────────────────────────────────────

const QUEUED_WHERE = { status: "active", invoiceId: null, fullyPaidOn: { not: null } } satisfies Prisma.CommissionEnrollmentWhereInput;

async function allInvoiceNumbers(): Promise<string[]> {
  return (await prisma.commissionInvoice.findMany({ select: { number: true } })).map((i) => i.number);
}

export async function suggestNumber(dateIso: string): Promise<string> {
  const settings = await getSettings();
  return suggestInvoiceNumber(settings.numberPrefix, dateIso, await allInvoiceNumbers(), settings.nextNumber);
}

/**
 * Draft one invoice for a partner from fully paid, un-invoiced enrollments.
 * Used by "Generate now" (Finance picks the enrollments) and by the monthly run
 * (every queued enrollment). The claim on each enrollment is checked inside the
 * transaction, so two runs can never bill the same enrollment twice.
 */
export async function createInvoice(opts: {
  partnerId: string;
  enrollmentIds: string[];
  invoiceDate: string;
  number?: string | null;
  source: "manual" | "monthly_run";
  userId: string | null;
}) {
  const ids = [...new Set(opts.enrollmentIds)];
  if (ids.length === 0) throw badRequest("Pick at least one fully paid enrollment.");
  const partner = await prisma.commissionPartner.findUnique({ where: { id: opts.partnerId } });
  if (!partner) throw notFound("That partner no longer exists.");
  const number = clean(opts.number) ?? (await suggestNumber(opts.invoiceDate));
  if (number.length > 60) throw badRequest("That invoice number is too long.");
  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const ens = await tx.commissionEnrollment.findMany({
        where: { id: { in: ids }, partnerId: partner.id, ...QUEUED_WHERE },
        orderBy: [{ fullyPaidOn: "asc" }, { candidateName: "asc" }],
      });
      if (ens.length !== ids.length) throw conflict("Some of those enrollments are no longer waiting to be invoiced. Reload and try again.");
      const inv = await tx.commissionInvoice.create({
        data: {
          number,
          partnerId: partner.id,
          invoiceDate: toDate(opts.invoiceDate),
          billToName: partner.name,
          billToAddress: partner.address,
          billToEmail: partner.email,
          billToFor: partner.forLine,
          source: opts.source,
          createdById: opts.userId,
        },
      });
      const claimed = await tx.commissionEnrollment.updateMany({ where: { id: { in: ids }, invoiceId: null }, data: { invoiceId: inv.id } });
      if (claimed.count !== ids.length) throw conflict("Some of those enrollments were just invoiced by someone else. Reload and try again.");
      await tx.commissionInvoiceLine.createMany({
        data: ens.map((e, i) => ({
          invoiceId: inv.id,
          enrollmentId: e.id,
          position: i + 1,
          program: e.program,
          description: defaultLineDescription(partner.layout, e.candidateName, e.program),
          studentId: e.studentId,
          courseName: e.courseName,
          intakeMonth: e.intakeMonth,
          courseFee: e.courseFee,
          commissionPct: e.commissionPct,
          commissionFlat: e.commissionFlat,
          amount: commissionOf(num(e.courseFee), num(e.commissionPct), flatOf(e.commissionFlat)),
        })),
      });
      return inv;
    });
    await recordAudit({ entityType: "CommissionInvoice", entityId: invoice.id, action: "CREATE", userId: opts.userId, changes: { number, source: opts.source, enrollmentIds: ids } });
    return invoice;
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`Invoice number ${number} is already used. Pick another number.`, "number_taken");
    throw e;
  }
}

async function loadInvoice(id: string) {
  const inv = await prisma.commissionInvoice.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } }, receipts: true, partner: true },
  });
  if (!inv) throw notFound("That invoice no longer exists.");
  return inv;
}

export type InvoicePatch = {
  number?: string;
  invoiceDate?: string;
  paymentTerm?: string;
  billToAddress?: string;
  billToEmail?: string | null;
  billToFor?: string | null;
  amountWords?: string | null;
  lines?: Array<{ id: string; description?: string; commissionPct?: number; commissionFlat?: number | null }>;
};

export async function updateInvoice(a: PcAccess, id: string, patch: InvoicePatch) {
  if (!a.isFinance) throw forbidden();
  const inv = await loadInvoice(id);
  if (!isEditableInvoice(inv.status)) throw conflict("This invoice is locked because a payment has been recorded against it.");
  const data: Prisma.CommissionInvoiceUpdateInput = {};
  if (patch.number !== undefined) {
    const n = patch.number.trim();
    if (!n) throw badRequest("Enter an invoice number.");
    if (n.length > 60) throw badRequest("That invoice number is too long.");
    data.number = n;
  }
  if (patch.invoiceDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.invoiceDate)) throw badRequest("Pick the invoice date.");
    data.invoiceDate = toDate(patch.invoiceDate);
  }
  if (patch.paymentTerm !== undefined) data.paymentTerm = patch.paymentTerm.trim().slice(0, 60) || "Immediate";
  if (patch.billToAddress !== undefined) data.billToAddress = patch.billToAddress.slice(0, 500);
  if (patch.billToEmail !== undefined) data.billToEmail = clean(patch.billToEmail);
  if (patch.billToFor !== undefined) data.billToFor = clean(patch.billToFor);
  if (patch.amountWords !== undefined) data.amountWords = clean(patch.amountWords);
  try {
    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length) await tx.commissionInvoice.update({ where: { id }, data });
      for (const l of patch.lines ?? []) {
        const line = inv.lines.find((x) => x.id === l.id);
        if (!line) throw notFound("That invoice line no longer exists.");
        const lineData: Prisma.CommissionInvoiceLineUpdateInput = {};
        if (l.description !== undefined) {
          const d = l.description.trim();
          if (!d) throw badRequest("A line needs a description.");
          lineData.description = d.slice(0, 200);
        }
        if (l.commissionPct !== undefined || l.commissionFlat !== undefined) {
          const pct = l.commissionPct !== undefined ? l.commissionPct : num(line.commissionPct);
          const flat = l.commissionFlat !== undefined ? l.commissionFlat : flatOf(line.commissionFlat);
          if (flat != null) checkFlat(flat);
          else checkPct(pct);
          lineData.commissionPct = pct;
          lineData.commissionFlat = flat;
          lineData.amount = commissionOf(num(line.courseFee), pct, flat);
          // Keep the enrollment's terms in step, so a line removed later queues at the agreed commission.
          if (line.enrollmentId) await tx.commissionEnrollment.update({ where: { id: line.enrollmentId }, data: { commissionPct: pct, commissionFlat: flat } });
        }
        await tx.commissionInvoiceLine.update({ where: { id: l.id }, data: lineData });
      }
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict(`Invoice number ${patch.number?.trim()} is already used by another invoice. Pick another number.`, "number_taken");
    throw e;
  }
  await recordAudit({ entityType: "CommissionInvoice", entityId: id, action: "UPDATE", userId: a.userId, changes: { ...patch } });
}

export async function removeInvoiceLine(a: PcAccess, id: string, lineId: string) {
  if (!a.isFinance) throw forbidden();
  const inv = await loadInvoice(id);
  if (!isEditableInvoice(inv.status)) throw conflict("This invoice is locked.");
  const line = inv.lines.find((l) => l.id === lineId);
  if (!line) throw notFound("That line is already gone.");
  await prisma.$transaction(async (tx) => {
    await tx.commissionInvoiceLine.delete({ where: { id: lineId } });
    if (line.enrollmentId) await tx.commissionEnrollment.updateMany({ where: { id: line.enrollmentId, invoiceId: id }, data: { invoiceId: null } });
  });
  await recordAudit({ entityType: "CommissionInvoice", entityId: id, action: "UPDATE", userId: a.userId, changes: { removedLine: line.description } });
}

export async function addInvoiceLine(a: PcAccess, id: string, enrollmentId: string) {
  if (!a.isFinance) throw forbidden();
  const inv = await loadInvoice(id);
  if (!isEditableInvoice(inv.status)) throw conflict("This invoice is locked.");
  await prisma.$transaction(async (tx) => {
    const e = await tx.commissionEnrollment.findFirst({ where: { id: enrollmentId, partnerId: inv.partnerId, ...QUEUED_WHERE } });
    if (!e) throw conflict("That enrollment isn't waiting to be invoiced for this partner.");
    const claimed = await tx.commissionEnrollment.updateMany({ where: { id: e.id, invoiceId: null }, data: { invoiceId: id } });
    if (claimed.count !== 1) throw conflict("That enrollment was just invoiced elsewhere.");
    await tx.commissionInvoiceLine.create({
      data: {
        invoiceId: id,
        enrollmentId: e.id,
        position: (inv.lines.reduce((m, l) => Math.max(m, l.position), 0) || 0) + 1,
        program: e.program,
        description: defaultLineDescription(inv.partner.layout, e.candidateName, e.program),
        studentId: e.studentId,
        courseName: e.courseName,
        intakeMonth: e.intakeMonth,
        courseFee: e.courseFee,
        commissionPct: e.commissionPct,
        commissionFlat: e.commissionFlat,
        amount: commissionOf(num(e.courseFee), num(e.commissionPct), flatOf(e.commissionFlat)),
      },
    });
  });
  await recordAudit({ entityType: "CommissionInvoice", entityId: id, action: "UPDATE", userId: a.userId, changes: { addedEnrollment: enrollmentId } });
}

export async function markInvoiceSent(a: PcAccess, id: string) {
  if (!a.isFinance) throw forbidden();
  const inv = await loadInvoice(id);
  if (inv.status !== "draft") throw conflict("Only a draft can be marked as sent.");
  if (inv.lines.length === 0) throw conflict("This invoice has no lines.");
  await prisma.commissionInvoice.update({ where: { id }, data: { status: "sent", sentAt: new Date() } });
  await recordAudit({ entityType: "CommissionInvoice", entityId: id, action: "UPDATE", userId: a.userId, changes: { status: "sent" } });
}

export async function deleteDraftInvoice(a: PcAccess, id: string) {
  if (!a.isFinance) throw forbidden();
  const inv = await loadInvoice(id);
  if (inv.status !== "draft") throw conflict("Only a draft can be deleted. Cancel a sent invoice instead.");
  await prisma.$transaction(async (tx) => {
    await tx.commissionEnrollment.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    await tx.commissionInvoice.delete({ where: { id } });
  });
  await recordAudit({ entityType: "CommissionInvoice", entityId: id, action: "DELETE", userId: a.userId, changes: { number: inv.number } });
}

export async function cancelInvoice(a: PcAccess, id: string) {
  if (!a.isFinance) throw forbidden();
  const inv = await loadInvoice(id);
  if (inv.status !== "sent") throw conflict("Only a sent invoice with no payments can be cancelled.");
  await prisma.$transaction(async (tx) => {
    await tx.commissionEnrollment.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    await tx.commissionInvoice.update({ where: { id }, data: { status: "cancelled", cancelledAt: new Date() } });
  });
  await recordAudit({ entityType: "CommissionInvoice", entityId: id, action: "UPDATE", userId: a.userId, changes: { status: "cancelled" } });
}

// ── receipts ─────────────────────────────────────────────────────────────────

export type ReceiptInput = {
  receivedOn: string;
  audSettled: number;
  aedAmount: number;
  inrAmount: number;
  reference?: string | null;
  settleInFull: boolean;
  skipLedger?: boolean;
};

function checkReceipt(r: ReceiptInput, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.receivedOn)) throw badRequest("Pick the date the money reached Wio.");
  if (r.receivedOn > today) throw badRequest("The received date can't be in the future.");
  if (!(r.aedAmount > 0)) throw badRequest("Enter the AED credited in Wio.");
  if (!(r.inrAmount > 0)) throw badRequest("Enter the AED → INR rate or the INR value.");
  if (!(r.audSettled > 0)) throw badRequest("Enter how much of the invoice (AUD) this payment settles.");
}

export async function recordReceipt(a: PcAccess, invoiceId: string, r: ReceiptInput, approveNow: boolean) {
  if (!a.isFinance) throw forbidden();
  checkReceipt(r, todayIst());
  const inv = await loadInvoice(invoiceId);
  if (inv.status !== "sent" && inv.status !== "partpaid") {
    throw conflict(inv.status === "draft" ? "Mark the invoice as sent first." : "This invoice can't take a payment right now.");
  }
  const total = invoiceTotal(inv.lines.map((l) => ({ amount: num(l.amount) })));
  const open = openAud(total, inv.receipts.map((x) => ({ status: x.status, audSettled: num(x.audSettled) })));
  if (round2(r.audSettled) > open) throw badRequest(`That's more than the AUD ${open} still open on this invoice.`);
  const receipt = await prisma.$transaction(async (tx) => {
    const created = await tx.commissionReceipt.create({
      data: {
        invoiceId,
        receivedOn: toDate(r.receivedOn),
        audSettled: round2(r.audSettled),
        aedAmount: round2(r.aedAmount),
        inrAmount: round2(r.inrAmount),
        aedInrRate: Math.round((r.inrAmount / r.aedAmount) * 1e6) / 1e6,
        reference: clean(r.reference),
        settleInFull: r.settleInFull,
        skipLedger: !!r.skipLedger,
        recordedById: a.userId,
      },
    });
    const moved = await tx.commissionInvoice.updateMany({ where: { id: invoiceId, status: inv.status }, data: { status: "awaiting" } });
    if (moved.count !== 1) throw conflict("Someone just changed this invoice. Reload and try again.");
    return created;
  });
  await recordAudit({ entityType: "CommissionReceipt", entityId: receipt.id, action: "SUBMIT_CREATE", userId: a.userId, changes: { invoice: inv.number, ...r } });
  if (approveNow && a.canApprove) {
    return approveReceipt(a, receipt.id, null);
  }
  await notifyApprovers(inv.number, inv.billToName, r.aedAmount, r.inrAmount).catch(() => undefined);
  return { receiptId: receipt.id, approved: false as const };
}

export async function updateReceipt(a: PcAccess, id: string, r: Partial<ReceiptInput>) {
  if (!a.isFinance) throw forbidden();
  const cur = await prisma.commissionReceipt.findUnique({ where: { id } });
  if (!cur) throw notFound();
  if (cur.status !== "awaiting") throw conflict("This payment has already been reviewed.");
  const merged: ReceiptInput = {
    receivedOn: r.receivedOn ?? isoDate(cur.receivedOn)!,
    audSettled: r.audSettled ?? num(cur.audSettled),
    aedAmount: r.aedAmount ?? num(cur.aedAmount),
    inrAmount: r.inrAmount ?? num(cur.inrAmount),
    reference: r.reference !== undefined ? r.reference : cur.reference,
    settleInFull: r.settleInFull ?? cur.settleInFull,
    skipLedger: r.skipLedger ?? cur.skipLedger,
  };
  checkReceipt(merged, todayIst());
  await prisma.commissionReceipt.update({
    where: { id },
    data: {
      receivedOn: toDate(merged.receivedOn),
      audSettled: round2(merged.audSettled),
      aedAmount: round2(merged.aedAmount),
      inrAmount: round2(merged.inrAmount),
      aedInrRate: Math.round((merged.inrAmount / merged.aedAmount) * 1e6) / 1e6,
      reference: clean(merged.reference),
      settleInFull: merged.settleInFull,
      skipLedger: !!merged.skipLedger,
    },
  });
  await recordAudit({ entityType: "CommissionReceipt", entityId: id, action: "UPDATE", userId: a.userId, changes: { ...r } });
}

/** The partner's Party for the Revenue rows: the linked one, else one named like it (created when missing). */
async function partnerPartyId(tx: Prisma.TransactionClient, partner: { id: string; name: string; partyId: string | null }): Promise<string> {
  if (partner.partyId) return partner.partyId;
  const existing = await tx.party.findFirst({
    where: { name: { equals: partner.name, mode: "insensitive" }, group: "Vendor" },
    select: { id: true },
  });
  const partyId = existing?.id ?? (await tx.party.create({ data: { name: partner.name, group: "Vendor", txTypes: "Both" } })).id;
  await tx.commissionPartner.update({ where: { id: partner.id }, data: { partyId } });
  return partyId;
}

/**
 * Approve a recorded payment: posts the INR value to Revenue › Commissions,
 * split by program, dated the day it reached Wio — unless the receipt is marked
 * as already in the ledger (cutover). Only the commission is ever booked.
 */
export async function approveReceipt(a: PcAccess, id: string, edits: Partial<ReceiptInput> | null) {
  if (!a.canApprove) throw forbidden("Only a Finance Manager or Admin can approve.");
  if (edits && Object.keys(edits).length) await updateReceipt(a, id, edits);
  const r = await prisma.commissionReceipt.findUnique({
    where: { id },
    include: { invoice: { include: { lines: true, partner: true, receipts: true } } },
  });
  if (!r) throw notFound();
  if (r.status !== "awaiting") throw conflict("This payment has already been reviewed.");
  const inv = r.invoice;
  const lines = inv.lines.map((l) => ({ program: l.program, amount: num(l.amount) }));
  const parts = r.skipLedger ? [] : splitByProgram(lines, num(r.inrAmount)).filter((p) => p.inr > 0);
  for (const p of parts) {
    const err = await verifyCategorySubItem(LEDGER.category, LEDGER.subItem(p.program), LEDGER.type);
    if (err) {
      throw unprocessable(
        `"${LEDGER.subItem(p.program)}" isn't an active sub-item under Revenue › ${LEDGER.category}. Add it in Master Data → Categories, then approve again.`,
        "sub_item_missing",
      );
    }
  }
  const receivedOn = r.receivedOn;
  const rate = num(r.aedInrRate).toFixed(4);
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.commissionReceipt.updateMany({
      where: { id, status: "awaiting" },
      data: { status: "approved", reviewedById: a.userId, reviewedAt: new Date() },
    });
    if (claimed.count !== 1) throw conflict("This payment has already been reviewed.");
    const txIds: string[] = [];
    if (parts.length) {
      const partyId = await partnerPartyId(tx, inv.partner);
      for (const p of parts) {
        const t = await tx.transaction.create({
          data: {
            date: receivedOn,
            month: monthCodeFromDate(receivedOn),
            type: LEDGER.type,
            category: LEDGER.category,
            subItem: LEDGER.subItem(p.program),
            description: `Commission · ${inv.number} · ${inv.billToName} · AED ${num(r.aedAmount)} @ ${rate}`.slice(0, 500),
            paymentMode: LEDGER.paymentMode,
            amount: p.inr,
            flow: flowFor("Revenue"),
            expDom: LEDGER.expDom,
            partyId,
            createdById: a.userId,
          },
        });
        txIds.push(t.id);
      }
      await tx.commissionReceipt.update({ where: { id }, data: { postedTxIds: txIds } });
    }
    const others = inv.receipts.filter((x) => x.id !== id);
    const approvedAud = others.filter((x) => x.status === "approved").reduce((s, x) => s + num(x.audSettled), 0) + num(r.audSettled);
    const anyAwaiting = others.some((x) => x.status === "awaiting");
    const settledInFull = r.settleInFull || others.some((x) => x.status === "approved" && x.settleInFull);
    const total = invoiceTotal(lines);
    const status = anyAwaiting ? "awaiting" : statusAfterApproval({ total, approvedAud, settleInFull: settledInFull });
    await tx.commissionInvoice.update({ where: { id: inv.id }, data: { status } });
    return { txIds, status };
  });
  for (const [i, txId] of result.txIds.entries()) {
    await recordAudit({ entityType: "Transaction", entityId: txId, action: "CREATE", userId: a.userId, changes: { source: "partner_commission", receiptId: id, invoice: inv.number, subItem: LEDGER.subItem(parts[i].program), amount: parts[i].inr } });
  }
  await recordAudit({ entityType: "CommissionReceipt", entityId: id, action: "APPROVE_CREATE", userId: a.userId, changes: { invoice: inv.number, posted: parts, skipLedger: r.skipLedger } });
  if (r.recordedById && r.recordedById !== a.userId) {
    await notifyUsers([r.recordedById], "Commission payment approved", `${inv.number} · ${inv.billToName}: ${r.skipLedger ? "marked paid (already in the ledger)" : `₹${num(r.inrAmount).toLocaleString("en-IN")} posted to Revenue › Commissions`}.`).catch(() => undefined);
  }
  return { receiptId: id, approved: true as const, posted: parts, invoiceStatus: result.status };
}

export async function sendBackReceipt(a: PcAccess, id: string, note: string | null) {
  if (!a.canApprove) throw forbidden("Only a Finance Manager or Admin can send a payment back.");
  const r = await prisma.commissionReceipt.findUnique({ where: { id }, include: { invoice: { include: { receipts: true } } } });
  if (!r) throw notFound();
  if (r.status !== "awaiting") throw conflict("This payment has already been reviewed.");
  const others = r.invoice.receipts.filter((x) => x.id !== id);
  const approvedAud = others.filter((x) => x.status === "approved").reduce((s, x) => s + num(x.audSettled), 0);
  const status = others.some((x) => x.status === "awaiting") ? "awaiting" : statusAfterReturn(approvedAud);
  await prisma.$transaction([
    prisma.commissionReceipt.update({ where: { id }, data: { status: "returned", reviewedById: a.userId, reviewedAt: new Date(), reviewNote: clean(note)?.slice(0, 500) ?? null } }),
    prisma.commissionInvoice.update({ where: { id: r.invoiceId }, data: { status } }),
  ]);
  await recordAudit({ entityType: "CommissionReceipt", entityId: id, action: "REJECT", userId: a.userId, changes: { note } });
  if (r.recordedById && r.recordedById !== a.userId) {
    await notifyUsers([r.recordedById], "Commission payment sent back", `${r.invoice.number}: ${clean(note) ?? "No reason given"}. Record it again from the invoice.`).catch(() => undefined);
  }
}

// ── notifications ────────────────────────────────────────────────────────────

const LINK = PC_FINANCE_PAGE;

/** Active users who can open the Finance page (and, if asked, approve). */
export async function financeRecipients(onlyApprovers = false): Promise<Array<{ id: string; email: string | null }>> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, email: true, role: true, roleRef: { select: { isAdmin: true, canApprove: true, pages: true } } },
  });
  return users
    .filter((u) => {
      const r = u.roleRef;
      if (!r) return u.role === "admin";
      if (r.isAdmin) return true;
      const hasPage = r.pages.some((p) => p === PC_FINANCE_PAGE || p.startsWith(`${PC_FINANCE_PAGE}/`));
      return hasPage && (!onlyApprovers || r.canApprove);
    })
    .map((u) => ({ id: u.id, email: u.email }));
}

async function notifyUsers(userIds: string[], title: string, body: string, link = LINK): Promise<number> {
  if (userIds.length === 0) return 0;
  const { count } = await prisma.crmNotification.createMany({
    data: userIds.map((userId) => ({ userId, kind: PC_NOTIFY_KIND, title: title.slice(0, 200), body: body.slice(0, 1000), linkUrl: link })),
  });
  return count;
}

async function notifyApprovers(number: string, partner: string, aed: number, inr: number) {
  const ids = (await financeRecipients(true)).map((u) => u.id);
  await notifyUsers(ids, "Commission payment awaiting approval", `${number} · ${partner} · AED ${aed} (₹${inr.toLocaleString("en-IN")}).`, `${LINK}?tab=payments`);
}

function appBaseUrl(): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production") return "https://desgro.in";
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// ── monthly run ──────────────────────────────────────────────────────────────

export type RunResult = { ran: boolean; reason?: string; invoices: Array<{ id: string; number: string; partner: string; total: number; lines: number }> };

/**
 * The monthly run: on (or after, if a day was missed) the settings' run day,
 * draft one invoice per partner from every fully paid, un-invoiced enrollment,
 * then alert Finance by bell and email. Runs at most once per IST month — the
 * CommissionRun row is claimed first, so a second cron fire is a no-op.
 */
export async function runMonthly(): Promise<RunResult> {
  const settings = await getSettings();
  const today = todayIst();
  const month = today.slice(0, 7);
  const already = await prisma.commissionRun.findUnique({ where: { month } });
  if (!runDue(today, settings.runDay, !!already)) return { ran: false, reason: already ? "already_ran" : "not_due", invoices: [] };
  try {
    await prisma.commissionRun.create({ data: { month } });
  } catch (e) {
    if (isUniqueViolation(e)) return { ran: false, reason: "already_ran", invoices: [] };
    throw e;
  }
  const queued = await prisma.commissionEnrollment.findMany({ where: QUEUED_WHERE, select: { id: true, partnerId: true } });
  const byPartner = new Map<string, string[]>();
  for (const q of queued) byPartner.set(q.partnerId, [...(byPartner.get(q.partnerId) ?? []), q.id]);
  const made: RunResult["invoices"] = [];
  for (const [partnerId, ids] of byPartner) {
    try {
      const inv = await createInvoice({ partnerId, enrollmentIds: ids, invoiceDate: today, source: "monthly_run", userId: null });
      const full = await loadInvoice(inv.id);
      made.push({ id: inv.id, number: inv.number, partner: full.billToName, total: invoiceTotal(full.lines.map((l) => ({ amount: num(l.amount) }))), lines: full.lines.length });
    } catch (e) {
      logger.error("pc_monthly_run_partner_failed", { partnerId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  await prisma.commissionRun.update({ where: { month }, data: { invoiceIds: made.map((m) => m.id) } });
  if (made.length) await alertRun(made, settings.emailAlerts).catch((e) => logger.error("pc_monthly_run_alert_failed", { error: e instanceof Error ? e.message : String(e) }));
  return { ran: true, invoices: made };
}

async function alertRun(made: RunResult["invoices"], email: boolean) {
  const recipients = await financeRecipients(false);
  const summary = made.map((m) => `${m.partner} AUD ${m.total.toLocaleString("en-US")} (${m.lines} line${m.lines === 1 ? "" : "s"}, ${m.number})`).join("; ");
  const title = `${made.length} commission invoice${made.length === 1 ? "" : "s"} drafted`;
  await notifyUsers(recipients.map((r) => r.id), title, `Monthly run: ${summary}. Review, download and send.`, `${LINK}?tab=invoices`);
  if (!email) return;
  const { getEmailConfig, sendEmail } = await import("@/lib/mailer");
  const cfg = await getEmailConfig();
  if (!cfg) {
    logger.warn("pc_monthly_run_email_skipped", { reason: "email_not_configured" });
    return;
  }
  const url = `${appBaseUrl()}${LINK}?tab=invoices`;
  const text = [
    "The monthly commission run has drafted these invoices:",
    "",
    ...made.map((m) => `• ${m.number} — ${m.partner}: AUD ${m.total.toLocaleString("en-US")} (${m.lines} line${m.lines === 1 ? "" : "s"})`),
    "",
    "Open them in DesGro to check, download the PDF and send to the partner:",
    url,
  ].join("\n");
  for (const r of recipients) {
    if (!r.email) continue;
    try {
      await sendEmail(cfg, { to: r.email, subject: `DesGro: ${title}`, text });
    } catch (e) {
      logger.error("pc_monthly_run_email_failed", { userId: r.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

// ── settings writes ──────────────────────────────────────────────────────────

export type SettingsPatch = Partial<
  Pick<
    CommissionSettings,
    | "issuerName"
    | "issuerAddress"
    | "issuerRegLine"
    | "bankAccountName"
    | "bankCurrency"
    | "bankIban"
    | "bankBic"
    | "bankAccountNo"
    | "signatoryName"
    | "numberPrefix"
    | "nextNumber"
    | "runDay"
    | "emailAlerts"
    | "bdePrograms"
  >
>;

export async function saveSettings(a: PcAccess, patch: SettingsPatch) {
  if (!a.canApprove) throw forbidden("Only a Finance Manager or Admin can change settings.");
  await getSettings();
  const data: Prisma.CommissionSettingsUpdateInput = { updatedById: a.userId };
  for (const k of ["issuerName", "issuerAddress", "issuerRegLine", "bankAccountName", "bankCurrency", "bankIban", "bankBic", "bankAccountNo", "signatoryName"] as const) {
    if (patch[k] !== undefined) data[k] = String(patch[k]).slice(0, 500);
  }
  if (patch.numberPrefix !== undefined) {
    const p = patch.numberPrefix.trim();
    if (!p || p.length > 30) throw badRequest("Enter the invoice number prefix, e.g. D/DLLC/.");
    data.numberPrefix = p;
  }
  if (patch.nextNumber !== undefined) {
    const n = (patch.nextNumber ?? "").trim();
    const prefix = (data.numberPrefix as string | undefined) ?? (await getSettings()).numberPrefix;
    if (n && !looksLikeSeries(prefix, n)) throw badRequest(`Enter the next number in the series, e.g. ${prefix}26-27/025.`);
    data.nextNumber = n || null;
  }
  if (patch.runDay !== undefined) {
    if (!Number.isInteger(patch.runDay) || patch.runDay < 1 || patch.runDay > 28) throw badRequest("The run day must be between 1 and 28.");
    data.runDay = patch.runDay;
  }
  if (patch.emailAlerts !== undefined) data.emailAlerts = !!patch.emailAlerts;
  if (patch.bdePrograms !== undefined) data.bdePrograms = patch.bdePrograms.filter(isProgramCode);
  await prisma.commissionSettings.update({ where: { id: "default" }, data });
  await recordAudit({ entityType: "CommissionSettings", entityId: "default", action: "UPDATE", userId: a.userId, changes: { ...patch, bankIban: patch.bankIban ? "(changed)" : undefined, bankAccountNo: patch.bankAccountNo ? "(changed)" : undefined } });
}

const MAX_SIGNATURE_BYTES = 400 * 1024;

export async function saveSignature(a: PcAccess, bytes: Uint8Array | null, mime: string | null) {
  if (!a.canApprove) throw forbidden();
  await getSettings();
  if (bytes) {
    if (mime !== "image/png" && mime !== "image/jpeg") throw badRequest("Upload the signature as a PNG or JPG.");
    if (bytes.byteLength > MAX_SIGNATURE_BYTES) throw badRequest("Keep the signature image under 400 KB.");
  }
  await prisma.commissionSettings.update({
    where: { id: "default" },
    data: { signaturePng: bytes ? Buffer.from(bytes) : null, signatureMime: bytes ? mime : null, updatedById: a.userId },
  });
  await recordAudit({ entityType: "CommissionSettings", entityId: "default", action: "UPDATE", userId: a.userId, changes: { signature: bytes ? "replaced" : "removed" } });
}

export type PartnerInput = { name: string; address: string; email?: string | null; forLine?: string | null; layout: string; isActive?: boolean };

export async function savePartner(a: PcAccess, id: string | null, p: PartnerInput) {
  if (!a.canApprove) throw forbidden();
  const name = p.name.trim();
  if (!name || name.length > 120) throw badRequest("Enter the partner's name.");
  if (p.layout !== "compact" && p.layout !== "detailed") throw badRequest("Pick an invoice layout.");
  const data = { name, address: p.address.slice(0, 500), email: clean(p.email), forLine: clean(p.forLine), layout: p.layout, isActive: p.isActive ?? true };
  try {
    const saved = id ? await prisma.commissionPartner.update({ where: { id }, data }) : await prisma.commissionPartner.create({ data });
    await recordAudit({ entityType: "CommissionPartner", entityId: saved.id, action: id ? "UPDATE" : "CREATE", userId: a.userId, changes: data });
    return saved;
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A partner with that name already exists.");
    throw e;
  }
}

export type ProgramInput = {
  code: string;
  partnerId: string;
  courseName: string;
  defaultFee: number | null;
  defaultPct: number | null;
  /** A flat AUD commission per enrollment; when set it replaces the percentage. */
  defaultFlat?: number | null;
  isActive?: boolean;
  /** Also move enrollments not yet invoiced onto the new commission. */
  applyToOpen?: boolean;
  /** Installment plans offered when enrolling (1–6), e.g. [1, 2, 6]. Omitted = unchanged. */
  installmentPlans?: number[];
};

export async function saveProgram(a: PcAccess, p: ProgramInput) {
  if (!a.canApprove) throw forbidden();
  if (!isProgramCode(p.code)) throw badRequest("Unknown program.");
  const partner = await prisma.commissionPartner.findUnique({ where: { id: p.partnerId } });
  if (!partner) throw badRequest("Pick the partner that runs this program.");
  const courseName = p.courseName.trim();
  if (!courseName) throw badRequest("Enter the course name printed on the invoice.");
  if (p.defaultFee != null) checkFee(p.defaultFee);
  if (p.defaultPct != null) checkPct(p.defaultPct);
  const defaultFlat = p.defaultFlat ?? null;
  if (defaultFlat != null) checkFlat(defaultFlat);
  if (p.installmentPlans && p.installmentPlans.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_INSTALLMENTS)) {
    throw badRequest(`Installment plans must be whole numbers from 1 to ${MAX_INSTALLMENTS}.`);
  }
  const data = {
    partnerId: p.partnerId,
    courseName,
    defaultFee: p.defaultFee,
    defaultPct: p.defaultPct,
    defaultFlat,
    isActive: p.isActive ?? true,
    ...(p.installmentPlans ? { installmentPlans: [...new Set(p.installmentPlans)].sort((x, y) => x - y) } : {}),
  };
  const saved = await prisma.commissionProgram.upsert({ where: { code: p.code }, create: { code: p.code, ...data }, update: data });
  // Enrollments already on an invoice keep what was billed; the rest can follow the new terms.
  let applied = 0;
  if (p.applyToOpen) {
    const res = await prisma.commissionEnrollment.updateMany({
      where: { program: p.code, invoiceId: null, status: "active" },
      data: defaultFlat != null ? { commissionFlat: defaultFlat } : { commissionFlat: null, ...(p.defaultPct != null ? { commissionPct: p.defaultPct } : {}) },
    });
    applied = res.count;
  }
  await recordAudit({ entityType: "CommissionProgram", entityId: saved.id, action: "UPDATE", userId: a.userId, changes: { code: p.code, ...data, appliedToOpenEnrollments: applied } });
  return { saved, applied };
}

export async function saveGrant(a: PcAccess, userId: string, programs: string[]) {
  if (!a.canApprove) throw forbidden();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw badRequest("That user no longer exists.");
  const list = [...new Set(programs.filter(isProgramCode))];
  if (list.length === 0) {
    await prisma.commissionEnrollGrant.deleteMany({ where: { userId } });
  } else {
    await prisma.commissionEnrollGrant.upsert({ where: { userId }, create: { userId, programs: list, grantedById: a.userId }, update: { programs: list, grantedById: a.userId } });
  }
  await recordAudit({ entityType: "CommissionEnrollGrant", entityId: userId, action: "UPDATE", userId: a.userId, changes: { programs: list } });
}

// ── reads ────────────────────────────────────────────────────────────────────

export const ENROLLMENT_INCLUDE = {
  payments: { orderBy: { seq: "asc" }, include: { createdBy: { select: { username: true } } } },
  invoice: { select: { id: true, number: true, status: true, source: true } },
  createdBy: { select: { username: true } },
  lead: { select: { id: true, candidateName: true, assignedToId: true } },
  partner: { select: { name: true } },
} satisfies Prisma.CommissionEnrollmentInclude;

export type EnrollmentRow = Prisma.CommissionEnrollmentGetPayload<{ include: typeof ENROLLMENT_INCLUDE }>;

export function serializeEnrollment(e: EnrollmentRow) {
  const payments = e.payments.map((p) => ({
    seq: p.seq,
    amount: num(p.amount),
    paidOn: isoDate(p.paidOn)!,
    reference: p.reference,
    recordedBy: p.createdBy?.username ?? null,
  }));
  return {
    id: e.id,
    program: e.program as ProgramCode,
    partnerId: e.partnerId,
    partnerName: e.partner.name,
    candidateName: e.candidateName,
    leadId: e.leadId,
    leadName: e.lead?.candidateName ?? null,
    studentId: e.studentId,
    courseName: e.courseName,
    intakeMonth: e.intakeMonth,
    courseFee: num(e.courseFee),
    commissionPct: num(e.commissionPct),
    commissionFlat: flatOf(e.commissionFlat),
    installmentPlan: e.installmentPlan,
    status: e.status,
    fullyPaidOn: isoDate(e.fullyPaidOn),
    invoice: e.invoice ? { id: e.invoice.id, number: e.invoice.number, status: e.invoice.status, source: e.invoice.source } : null,
    notes: e.notes,
    createdBy: e.createdBy?.username ?? null,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    payments,
    balance: balanceOf(num(e.courseFee), payments),
  };
}
export type EnrollmentDTO = ReturnType<typeof serializeEnrollment>;
