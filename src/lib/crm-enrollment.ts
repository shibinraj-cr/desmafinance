/**
 * An enrollment's life after the BDE submits the Enroll sheet
 * (src/lib/crm-enroll.ts creates it; the rules are in crm-enroll-confirm.ts).
 *
 *   pending ──Finance approves──▶ verified   (ledger row + collection plan; invoice)
 *      │  ▲
 *      │  └──BDE fixes and resubmits── sent_back ◀──Finance sends back──┘
 *      └──Finance finds no money──▶ not_received   (the sales head decides: un-enroll)
 *   un-enrolled before verification ──▶ withdrawn  (src/lib/crm-unenroll.ts)
 *
 * The enrollment counts from submit everywhere except the incentive, which
 * waits for verification (src/lib/crm-incentive-data.ts). Finance may change
 * anything but the service; every change is logged on the lead as
 * "BDE said X → Finance set Y" and the BDE is told. A first payment under
 * MIN_FIRST_PAYMENT waits for the sales head before Finance can approve.
 *
 * Every write claims the row by status in its transaction, so an approve, a
 * BDE edit and an un-enroll can't interleave.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentUserAndPermissions } from "./permissions";
import { canApprove as roleCanApprove, canSeePage, isAdmin, type Permissions } from "./rbac";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "./http-error";
import { recordLeadActivity } from "./crm-activity";
import { recordAudit } from "./audit";
import { MONTHS, flowFor, monthCodeFromDate } from "./catalog";
import { isHistoricalDate } from "./finance-historical";
import { fromPrismaDate, toPrismaDate, todayIst } from "./lead-pulse-dates";
import { verifyCategorySubItem } from "./master-data";
import { formatEnrollDate } from "./crm-enroll-date";
import { moveEnrollmentClose, resolveRevenueClassification } from "./crm-enroll";
import { notifyEnrollment, salesHeadUserIds } from "./crm-notify";
import {
  MIN_FIRST_PAYMENT,
  OPEN_STATUSES,
  approveBlocker,
  changeSummary,
  confirmProblems,
  enrollmentChanges,
  financeProblems,
  nextException,
  parsePlan,
  type EnrollConfirm,
  type EnrollmentFields,
  type EnrollmentStatus,
  type FieldChange,
} from "./crm-enroll-confirm";

export const ENROLLMENTS_PAGE = "/finance/enrollments";

/** Moving an enrollment's date touches the pipeline and two daily entries: allow for it. */
const TX_OPTS = { timeout: 20_000, maxWait: 10_000 };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// ── reading ──────────────────────────────────────────────────────────────────

const personSelect = { username: true, leadPulseRole: { select: { displayName: true } } } as const;
const nameOf = (u: { username: string; leadPulseRole: { displayName: string } | null } | null) =>
  u ? u.leadPulseRole?.displayName ?? u.username : null;

const ROW = {
  id: true,
  leadId: true,
  partyId: true,
  serviceId: true,
  pipelineId: true,
  ownerUserId: true,
  submittedById: true,
  status: true,
  exception: true,
  exceptionAt: true,
  exceptionNote: true,
  billingName: true,
  billingCountry: true,
  billingState: true,
  billingAddress: true,
  billingPin: true,
  totalAmount: true,
  firstAmount: true,
  paidOn: true,
  paymentMode: true,
  utr: true,
  payerRelation: true,
  payerName: true,
  plan: true,
  category: true,
  subItem: true,
  expDom: true,
  submitted: true,
  financeNote: true,
  transactionId: true,
  collectionPlanId: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  lead: { select: { candidateName: true, country: true } },
  service: { select: { name: true } },
  owner: { select: personSelect },
  submittedBy: { select: personSelect },
  verifiedBy: { select: personSelect },
  exceptionBy: { select: personSelect },
  transaction: { select: { invoices: { where: { status: "issued" }, select: { id: true, number: true }, take: 1 } } },
} satisfies Prisma.CrmEnrollmentSelect;
type Row = Prisma.CrmEnrollmentGetPayload<{ select: typeof ROW }>;

const num = (d: { toString(): string } | null) => (d == null ? null : Number(d.toString()));

/** The row's comparable fields, Finance's included. */
export function fieldsOf(e: {
  billingName: string;
  billingCountry: string;
  billingState: string | null;
  billingAddress: string | null;
  billingPin: string | null;
  totalAmount: { toString(): string };
  firstAmount: { toString(): string } | null;
  paidOn: Date | null;
  paymentMode: string | null;
  utr: string | null;
  payerRelation: string | null;
  payerName: string | null;
  plan: unknown;
  category: string | null;
  subItem: string | null;
  expDom: string | null;
}): Required<EnrollmentFields> {
  return {
    billingName: e.billingName,
    billingCountry: e.billingCountry,
    billingState: e.billingState,
    billingAddress: e.billingAddress,
    billingPin: e.billingPin,
    totalAmount: Number(e.totalAmount.toString()),
    firstAmount: num(e.firstAmount),
    paidOn: e.paidOn ? fromPrismaDate(e.paidOn) : null,
    paymentMode: e.paymentMode,
    utr: e.utr,
    payerRelation: e.payerRelation,
    payerName: e.payerName,
    plan: parsePlan(e.plan),
    category: e.category,
    subItem: e.subItem,
    expDom: e.expDom,
  };
}

/** The BDE's snapshot (JSON) as fields; Finance's fields are absent. */
function submittedOf(json: unknown, fallback: EnrollmentFields): EnrollmentFields {
  const j = (json && typeof json === "object" ? json : {}) as Partial<EnrollmentFields>;
  return {
    billingName: j.billingName ?? fallback.billingName,
    billingCountry: j.billingCountry ?? fallback.billingCountry,
    billingState: j.billingState ?? null,
    billingAddress: j.billingAddress ?? null,
    billingPin: j.billingPin ?? null,
    totalAmount: Number(j.totalAmount ?? fallback.totalAmount),
    firstAmount: j.firstAmount == null ? null : Number(j.firstAmount),
    paidOn: j.paidOn ?? null,
    paymentMode: j.paymentMode ?? null,
    utr: j.utr ?? null,
    payerRelation: j.payerRelation ?? null,
    payerName: j.payerName ?? null,
    plan: parsePlan(j.plan),
  };
}

function serialize(e: Row, repeat = false) {
  const fields = fieldsOf(e);
  return {
    id: e.id,
    leadId: e.leadId,
    partyId: e.partyId,
    candidateName: e.lead.candidateName,
    leadCountry: e.lead.country,
    serviceName: e.service.name,
    ownerName: nameOf(e.owner),
    submittedByName: nameOf(e.submittedBy),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    status: e.status as EnrollmentStatus,
    exception: e.exception as "pending" | "approved" | "rejected" | null,
    exceptionNote: e.exceptionNote,
    exceptionByName: nameOf(e.exceptionBy),
    exceptionAt: e.exceptionAt?.toISOString() ?? null,
    fields,
    submitted: submittedOf(e.submitted, fields),
    financeNote: e.financeNote,
    verifiedByName: nameOf(e.verifiedBy),
    verifiedAt: e.verifiedAt?.toISOString() ?? null,
    transactionId: e.transactionId,
    invoice: e.transaction?.invoices[0] ?? null,
    /** The candidate already holds another service: a re-enrollment. */
    repeat,
  };
}
export type EnrollmentDTO = ReturnType<typeof serialize>;

/** The lead's live enrollment (the latest that wasn't withdrawn), for the lead page. */
export async function leadEnrollment(leadId: string): Promise<EnrollmentDTO | null> {
  const e = await prisma.crmEnrollment.findFirst({
    where: { leadId, status: { not: "withdrawn" } },
    orderBy: { createdAt: "desc" },
    select: ROW,
  });
  return e ? serialize(e) : null;
}

export type EnrollmentTab = "verify" | "sent-back" | "not-received" | "verified";
const TAB_WHERE: Record<EnrollmentTab, Prisma.CrmEnrollmentWhereInput> = {
  verify: { status: "pending" },
  "sent-back": { status: "sent_back" },
  "not-received": { status: "not_received" },
  verified: { status: "verified" },
};

/** One tab of Finance's queue, oldest first (verified: newest first), with every tab's count. */
export async function listEnrollments(tab: EnrollmentTab) {
  const [rows, counts] = await Promise.all([
    prisma.crmEnrollment.findMany({
      where: TAB_WHERE[tab],
      orderBy: tab === "verified" ? { verifiedAt: "desc" } : { createdAt: "asc" },
      take: tab === "verified" ? 100 : 300,
      select: ROW,
    }),
    prisma.crmEnrollment.groupBy({ by: ["status"], _count: { _all: true }, where: { status: { in: ["pending", "sent_back", "not_received"] } } }),
  ]);
  // Re-enrollments: the candidate holds a service other than this one.
  const others = rows.length
    ? await prisma.partyService.findMany({
        where: { partyId: { in: rows.map((r) => r.partyId) } },
        select: { partyId: true, serviceId: true },
      })
    : [];
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  return {
    rows: rows.map((r) => serialize(r, others.some((o) => o.partyId === r.partyId && o.serviceId !== r.serviceId))),
    counts: { verify: count("pending"), "sent-back": count("sent_back"), "not-received": count("not_received") },
  };
}

/** One enrollment and its history on the lead, for Finance's review panel. */
export async function enrollmentDetail(id: string) {
  const e = await prisma.crmEnrollment.findUnique({ where: { id }, select: ROW });
  if (!e) throw notFound();
  const history = await prisma.leadActivity.findMany({
    where: { leadId: e.leadId, type: { startsWith: "ENROLLMENT_" }, occurredAt: { gte: new Date(e.createdAt.getTime() - 60_000) } },
    orderBy: { occurredAt: "asc" },
    select: { id: true, type: true, summary: true, occurredAt: true, actor: { select: personSelect } },
  });
  return {
    enrollment: serialize(e),
    history: history.map((h) => ({ id: h.id, type: h.type, summary: h.summary, at: h.occurredAt.toISOString(), by: nameOf(h.actor) })),
  };
}

// ── access ───────────────────────────────────────────────────────────────────

export type EnrollmentAccess = { userId: string; perms: Permissions; canView: boolean; canApprove: boolean };

/** Finance (anyone with the Verify enrollments page) reviews and edits; approvers post to the ledger. */
export async function getEnrollmentAccess(): Promise<EnrollmentAccess | null> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return null;
  const canView = isAdmin(perms) || canSeePage(perms, ENROLLMENTS_PAGE);
  return { userId, perms, canView, canApprove: canView && roleCanApprove(perms) };
}

export async function requireEnrollmentAccess(need: "view" | "approve"): Promise<EnrollmentAccess> {
  const a = await getEnrollmentAccess();
  if (!a) throw unauthorized();
  if (!a.canView) throw forbidden("You don't have access to Verify enrollments.");
  if (need === "approve" && !a.canApprove) throw forbidden("Only a Finance approver (the Finance Manager, or the director) can approve.");
  return a;
}

// ── writing ──────────────────────────────────────────────────────────────────

/** The row's columns for a set of fields. */
function columns(f: EnrollmentFields): Prisma.CrmEnrollmentUncheckedUpdateManyInput {
  return {
    billingName: f.billingName.trim(),
    billingCountry: f.billingCountry.trim(),
    billingState: f.billingState,
    billingAddress: f.billingAddress,
    billingPin: f.billingPin,
    totalAmount: f.totalAmount,
    firstAmount: f.firstAmount,
    paidOn: f.paidOn ? toPrismaDate(f.paidOn) : null,
    paymentMode: f.paymentMode,
    utr: f.utr,
    payerRelation: f.payerRelation,
    payerName: f.payerRelation === "candidate" ? null : f.payerName,
    plan: f.plan as unknown as Prisma.InputJsonValue,
    ...(f.category !== undefined ? { category: f.category } : {}),
    ...(f.subItem !== undefined ? { subItem: f.subItem } : {}),
    ...(f.expDom !== undefined ? { expDom: f.expDom } : {}),
  };
}

/**
 * Write new fields onto an enrollment still in `allowed`, and keep what hangs
 * off them in step: a new payment date moves the enrollment's month, a new
 * total becomes the candidate's package and the deal value. Throws when the
 * enrollment left `allowed` meanwhile.
 */
async function writeFields(
  tx: Prisma.TransactionClient,
  e: Row,
  next: EnrollmentFields,
  allowed: EnrollmentStatus[],
  extra: Prisma.CrmEnrollmentUncheckedUpdateManyInput,
): Promise<void> {
  const res = await tx.crmEnrollment.updateMany({
    where: { id: e.id, status: { in: allowed } },
    data: { ...columns(next), ...extra },
  });
  if (res.count !== 1) throw conflict("This enrollment changed while you were editing it. Reload it and try again.", "enrollment_changed");
  const before = fieldsOf(e);
  if (next.paidOn && next.paidOn !== before.paidOn) {
    if (e.pipelineId) await moveEnrollmentClose(tx, e.pipelineId, next.paidOn);
    await tx.lead.update({ where: { id: e.leadId }, data: { expectedCloseDate: toPrismaDate(next.paidOn) } });
  }
  if (next.totalAmount !== before.totalAmount) {
    await tx.partyService.updateMany({ where: { partyId: e.partyId, serviceId: e.serviceId }, data: { totalAmount: next.totalAmount } });
    await tx.lead.update({ where: { id: e.leadId }, data: { expectedValue: next.totalAmount } });
    if (e.pipelineId) await tx.leadPulsePipeline.update({ where: { id: e.pipelineId }, data: { expectedFirstInstallment: next.totalAmount } });
  }
}

async function lockRow(tx: Prisma.TransactionClient, id: string): Promise<Row> {
  // Row lock first: an approve, an edit and an un-enroll on one enrollment queue up here.
  await tx.$queryRaw`SELECT id FROM "CrmEnrollment" WHERE id = ${id} FOR UPDATE`;
  const e = await tx.crmEnrollment.findUnique({ where: { id }, select: ROW });
  if (!e) throw notFound("Enrollment not found.");
  return e;
}

const bdeOf = (e: { ownerUserId: string | null; submittedById: string | null }) => [e.ownerUserId, e.submittedById];

async function askSalesHead(e: Row, firstAmount: number, actorId: string) {
  await recordLeadActivity({
    leadId: e.leadId,
    actorId,
    type: "ENROLLMENT_EXCEPTION",
    summary: `First payment ${inr(firstAmount)} is under ${inr(MIN_FIRST_PAYMENT)}: waiting for the sales head to approve`,
    metadata: { enrollmentId: e.id, decision: "requested" },
  });
  await notifyEnrollment({
    userIds: await salesHeadUserIds(),
    actorUserId: actorId,
    leadId: e.leadId,
    title: "First payment under the minimum",
    body: `${e.lead.candidateName}'s first payment for ${e.service.name} is ${inr(firstAmount)}, under ${inr(MIN_FIRST_PAYMENT)}. Approve or reject the exception on the lead.`,
  });
}

/**
 * The BDE corrects their enrollment: while Finance hasn't verified it
 * (pending), after Finance sent it back, or after Finance found no money
 * (with the right UTR, say). It goes back to Finance as pending.
 */
export async function editEnrollmentByBde(args: {
  leadId: string;
  actorId: string;
  canBackdate: boolean;
  confirm: EnrollConfirm;
}): Promise<{ changes: FieldChange[] }> {
  const current = await prisma.crmEnrollment.findFirst({
    where: { leadId: args.leadId, status: { not: "withdrawn" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!current) throw notFound("This lead has no enrollment to edit.");
  const today = todayIst();

  const out = await prisma.$transaction(async (tx) => {
    const e = await lockRow(tx, current.id);
    if (!OPEN_STATUSES.includes(e.status as EnrollmentStatus)) {
      throw conflict(e.status === "verified" ? "Finance has already verified this enrollment. Ask Finance to change it." : "This enrollment can't be edited now.", "enrollment_closed");
    }
    const before = fieldsOf(e);
    const c = args.confirm;
    // The date window binds a changed date only: a sent-back enrollment from
    // last month keeps its date even once last month has closed.
    const problems = confirmProblems(c, { today, canBackdate: args.canBackdate, dateWindow: c.paidOn !== before.paidOn });
    if (problems.length) throw badRequest(problems[0].message, `enroll_${problems[0].field}`);
    const next: EnrollmentFields = {
      billingName: c.billingName,
      billingCountry: c.billingCountry,
      billingState: c.billingState,
      billingAddress: c.billingAddress,
      billingPin: c.billingPin,
      totalAmount: c.totalAmount,
      firstAmount: c.firstAmount,
      paidOn: c.paidOn,
      paymentMode: c.paymentMode,
      utr: c.utr,
      payerRelation: c.payerRelation,
      payerName: c.payerRelation === "candidate" ? null : c.payerName,
      plan: c.plan,
    };
    const changes = enrollmentChanges(before, next);
    const exception = nextException(e.exception, before.firstAmount, next.firstAmount);
    await writeFields(tx, e, next, OPEN_STATUSES, {
      status: "pending",
      financeNote: null,
      submitted: next as unknown as Prisma.InputJsonValue,
      ...(exception !== e.exception ? { exception, exceptionById: null, exceptionAt: null, exceptionNote: null } : {}),
    });
    return { e, changes, wasStatus: e.status, newException: exception !== e.exception && exception === "pending" ? next.firstAmount : null };
   }, TX_OPTS);

  const resubmitted = out.wasStatus !== "pending";
  await recordLeadActivity({
    leadId: args.leadId,
    actorId: args.actorId,
    type: "ENROLLMENT_EDITED",
    summary: `${resubmitted ? "Enrollment fixed and sent back to Finance" : "Enrollment details changed"}${out.changes.length ? `: ${changeSummary(out.changes)}` : ""}`,
    metadata: { enrollmentId: out.e.id, by: "bde", changes: out.changes, resubmitted },
  });
  if (out.newException != null) await askSalesHead(out.e, out.newException, args.actorId);
  return { changes: out.changes };
}

/** The sales head approves or rejects a first payment under the minimum. */
export async function decideException(args: { leadId: string; actorId: string; approve: boolean; note: string | null }) {
  const e = await prisma.crmEnrollment.findFirst({
    where: { leadId: args.leadId, status: { not: "withdrawn" }, exception: "pending" },
    orderBy: { createdAt: "desc" },
    select: ROW,
  });
  if (!e) throw conflict("There's no first-payment exception waiting on this lead.", "no_exception");
  const decision = args.approve ? "approved" : "rejected";
  const res = await prisma.crmEnrollment.updateMany({
    where: { id: e.id, exception: "pending" },
    data: { exception: decision, exceptionById: args.actorId, exceptionAt: new Date(), exceptionNote: args.note },
  });
  if (res.count !== 1) throw conflict("Someone decided this exception just now.", "no_exception");
  const amount = num(e.firstAmount) ?? 0;
  await recordLeadActivity({
    leadId: e.leadId,
    actorId: args.actorId,
    type: "ENROLLMENT_EXCEPTION",
    summary: args.approve
      ? `Sales head approved the first payment of ${inr(amount)} (under ${inr(MIN_FIRST_PAYMENT)})${args.note ? `: ${args.note}` : ""}`
      : `Sales head rejected the first payment of ${inr(amount)} (under ${inr(MIN_FIRST_PAYMENT)})${args.note ? `: ${args.note}` : ""}. The enrollment should be undone.`,
    metadata: { enrollmentId: e.id, decision },
  });
  await notifyEnrollment({
    userIds: bdeOf(e),
    actorUserId: args.actorId,
    leadId: e.leadId,
    title: args.approve ? "Smaller first payment approved" : "Smaller first payment rejected",
    body: args.approve
      ? `The sales head approved ${e.lead.candidateName}'s first payment of ${inr(amount)}. Finance can now verify the enrollment.`
      : `The sales head rejected ${e.lead.candidateName}'s first payment of ${inr(amount)}${args.note ? ` (${args.note})` : ""}. The enrollment will be undone.`,
  });
  return { decision };
}

/** A partial change from Finance's review panel. */
export type FinancePatch = Partial<EnrollmentFields>;

function merged(e: Row, patch: FinancePatch): Required<EnrollmentFields> {
  const f = fieldsOf(e);
  const next = { ...f } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && k in f) next[k] = v;
  return next as Required<EnrollmentFields>;
}

/** The category and sub-item must be live Revenue master entries. Reads on the transaction's connection. */
async function checkClassification(tx: Prisma.TransactionClient, f: EnrollmentFields) {
  if (f.category && f.subItem) {
    const err = await verifyCategorySubItem(f.category, f.subItem, "Revenue", tx);
    if (err) throw badRequest(err === "category_not_found" ? "Pick a Revenue category from the list." : "Pick a sub-item of that category.", "classification_invalid");
  }
}

/** Finance edits an open enrollment. Every change is logged and the BDE told. */
export async function financeSave(a: EnrollmentAccess, id: string, patch: FinancePatch) {
  const out = await prisma.$transaction(async (tx) => {
    const e = await lockRow(tx, id);
    if (!OPEN_STATUSES.includes(e.status as EnrollmentStatus)) throw conflict("Only an enrollment waiting for Finance can be changed.", "enrollment_closed");
    const next = merged(e, patch);
    const problems = financeProblems(next, todayIst());
    if (problems.length) throw badRequest(problems[0], "enrollment_invalid");
    await checkClassification(tx, next);
    const before = fieldsOf(e);
    const changes = enrollmentChanges(before, next);
    if (!changes.length) return { e, changes, newException: null };
    const exception = nextException(e.exception, before.firstAmount, next.firstAmount);
    await writeFields(tx, e, next, OPEN_STATUSES, exception !== e.exception ? { exception, exceptionById: null, exceptionAt: null, exceptionNote: null } : {});
    return { e, changes, newException: exception !== e.exception && exception === "pending" ? next.firstAmount : null };
   }, TX_OPTS);
  if (out.changes.length) await logFinanceChanges(a, out.e, out.changes);
  if (out.newException != null) await askSalesHead(out.e, out.newException, a.userId);
  return { changes: out.changes };
}

/** "BDE said X → Finance set Y", on the lead and the audit trail, and the BDE is told (BDE-visible fields only). */
async function logFinanceChanges(a: EnrollmentAccess, e: Row, changes: FieldChange[]) {
  await recordLeadActivity({
    leadId: e.leadId,
    actorId: a.userId,
    type: "ENROLLMENT_EDITED",
    summary: `Finance changed the enrollment: ${changeSummary(changes)}`,
    metadata: { enrollmentId: e.id, by: "finance", changes },
  });
  await recordAudit({ entityType: "CrmEnrollment", entityId: e.id, action: "UPDATE", userId: a.userId, changes: { changes } });
  const seen = changes.filter((c) => !["category", "subItem", "expDom"].includes(c.field));
  if (seen.length) {
    await notifyEnrollment({
      userIds: bdeOf(e),
      actorUserId: a.userId,
      leadId: e.leadId,
      title: "Finance corrected an enrollment",
      body: `${e.lead.candidateName}: ${changeSummary(seen)}.`,
    });
  }
}

/** The ledger month a payment date files under, or why it can't be filed. */
function ledgerMonth(paidOn: string): string {
  const d = toPrismaDate(paidOn);
  const code = monthCodeFromDate(d);
  if (isHistoricalDate(d) || (MONTHS as readonly string[]).includes(code)) return code;
  throw badRequest(`The ledger has no month for ${formatEnrollDate(paidOn)} yet. Ask an admin to open the new financial year.`, "month_out_of_range");
}

/**
 * Finance approves: the first payment goes into the ledger (dated the day it
 * landed, into the account it landed in), the balance plan becomes the
 * candidate's collection plan with the first payment as its received first
 * row, and the passport name and address become the candidate's billing
 * details. Any last edits in `patch` are applied (and logged) first.
 */
export async function approveEnrollment(a: EnrollmentAccess, id: string, patch: FinancePatch | null) {
  if (!a.canApprove) throw forbidden("Only a Finance approver (the Finance Manager, or the director) can approve.");
  const collection = await prisma.crmEnrollment
    .findUnique({ where: { id }, select: { serviceId: true } })
    .then((r) => (r ? resolveRevenueClassification(r.serviceId, "collection") : null));
  if (!collection) throw notFound("Enrollment not found.");

  const out = await prisma.$transaction(
    async (tx) => {
      const e = await lockRow(tx, id);
      if (!OPEN_STATUSES.includes(e.status as EnrollmentStatus)) {
        throw conflict(e.status === "verified" ? "This enrollment is already verified." : "This enrollment can't be approved now.", "enrollment_closed");
      }
      const before = fieldsOf(e);
      const f = patch ? merged(e, patch) : before;
      const problems = financeProblems(f, todayIst());
      if (problems.length) throw badRequest(problems[0], "enrollment_invalid");
      const exception = nextException(e.exception, before.firstAmount, f.firstAmount);
      const blocker = approveBlocker({ ...f, status: e.status, exception });
      if (blocker) throw conflict(blocker, "cannot_approve");
      await checkClassification(tx, f);
      const month = ledgerMonth(f.paidOn!);
      const changes = enrollmentChanges(before, f);
      const now = new Date();
      // Claim it: verified, with these fields. Throws if it moved meanwhile.
      await writeFields(tx, e, f, OPEN_STATUSES, { status: "verified", verifiedById: a.userId, verifiedAt: now, financeNote: null, exception });

      const payer = f.payerRelation && f.payerRelation !== "candidate" ? ` · paid by ${f.payerRelation}${f.payerName ? ` ${f.payerName}` : ""}` : "";
      const row = await tx.transaction.create({
        data: {
          date: toPrismaDate(f.paidOn!),
          month,
          type: "Revenue",
          category: f.category!,
          subItem: f.subItem!,
          description: `Enrollment — ${e.lead.candidateName} · ${e.service.name}${f.utr ? ` · UTR ${f.utr}` : ""}${payer}`,
          paymentMode: f.paymentMode!,
          amount: f.firstAmount!,
          flow: flowFor("Revenue"),
          partyId: e.partyId,
          expDom: f.expDom,
          isHistorical: isHistoricalDate(f.paidOn!),
          createdById: a.userId,
        },
        select: { id: true },
      });
      const plan = await tx.collectionPlan.create({
        data: {
          partyId: e.partyId,
          serviceId: e.serviceId,
          label: `${e.service.name} — enrollment plan`,
          category: collection.category,
          subItem: collection.subItem,
          expDom: f.expDom,
          status: f.plan.length ? "active" : "closed",
          createdById: a.userId,
          installments: {
            create: [
              {
                seq: 1,
                expectedDate: toPrismaDate(f.paidOn!),
                amount: f.firstAmount!,
                category: f.category,
                subItem: f.subItem,
                paymentMode: f.paymentMode,
                description: "First payment (enrollment)",
                status: "received",
                transactionId: row.id,
              },
              ...f.plan.map((p, i) => ({ seq: i + 2, expectedDate: toPrismaDate(p.date), amount: p.amount, status: "pending" })),
            ],
          },
        },
        select: { id: true },
      });
      await tx.crmEnrollment.update({ where: { id: e.id }, data: { transactionId: row.id, collectionPlanId: plan.id } });
      await tx.party.update({
        where: { id: e.partyId },
        data: {
          billingName: f.billingName.trim(),
          billingAddress: f.billingAddress,
          billingPin: f.billingPin,
          billingState: f.billingState,
          billingCountry: f.billingCountry.trim(),
        },
      });
      return { e, f, changes, transactionId: row.id, planId: plan.id };
    },
    TX_OPTS,
  );

  if (out.changes.length) await logFinanceChanges(a, out.e, out.changes);
  const f = out.f;
  await recordAudit({
    entityType: "Transaction",
    entityId: out.transactionId,
    action: "CREATE",
    userId: a.userId,
    changes: { via: "crm_enrollment", enrollmentId: out.e.id, amount: f.firstAmount, date: f.paidOn, paymentMode: f.paymentMode, planId: out.planId },
  });
  await recordLeadActivity({
    leadId: out.e.leadId,
    actorId: a.userId,
    type: "ENROLLMENT_VERIFIED",
    summary: `Finance verified the enrollment: ${inr(f.firstAmount!)} received into ${f.paymentMode} on ${formatEnrollDate(f.paidOn!)}${f.plan.length ? `; balance of ${inr(f.plan.reduce((s, p) => s + p.amount, 0))} planned` : ""}`,
    metadata: { enrollmentId: out.e.id, transactionId: out.transactionId, collectionPlanId: out.planId },
  });
  await notifyEnrollment({
    userIds: bdeOf(out.e),
    actorUserId: a.userId,
    leadId: out.e.leadId,
    title: "Enrollment verified",
    body: `Finance verified ${out.e.lead.candidateName}'s enrollment (${inr(f.firstAmount!)} received).`,
  });
  return { transactionId: out.transactionId, fields: f, partyId: out.e.partyId, serviceName: out.e.service.name, subItem: f.subItem };
}

/** Finance sends the enrollment back to the BDE to fix. */
export async function sendBack(a: EnrollmentAccess, id: string, note: string) {
  return closeWithNote(a, id, note, {
    from: ["pending", "not_received"],
    to: "sent_back",
    type: "ENROLLMENT_SENT_BACK",
    summary: (n) => `Finance sent the enrollment back to fix: ${n}`,
    notify: async (e, n) =>
      notifyEnrollment({
        userIds: bdeOf(e),
        actorUserId: a.userId,
        leadId: e.leadId,
        title: "Enrollment sent back",
        body: `Finance sent ${e.lead.candidateName}'s enrollment back: ${n}. Fix it on the lead and send it again.`,
      }),
  });
}

/** Finance found no money: the sales head decides whether to un-enroll. Never undone silently. */
export async function markNotReceived(a: EnrollmentAccess, id: string, note: string) {
  return closeWithNote(a, id, note, {
    from: ["pending", "sent_back"],
    to: "not_received",
    type: "ENROLLMENT_NOT_RECEIVED",
    summary: (n) => `Finance found no money for this enrollment: ${n}. Un-enroll requested from the sales head.`,
    notify: async (e, n) => {
      await notifyEnrollment({
        userIds: await salesHeadUserIds(),
        actorUserId: a.userId,
        leadId: e.leadId,
        title: "Un-enroll requested: money not received",
        body: `Finance found no payment for ${e.lead.candidateName} (${e.service.name}): ${n}. Un-enroll the lead unless the money turns up.`,
      });
      await notifyEnrollment({
        userIds: bdeOf(e),
        actorUserId: a.userId,
        leadId: e.leadId,
        title: "Finance found no payment",
        body: `Finance couldn't find ${e.lead.candidateName}'s payment: ${n}. If it was paid, fix the details (the UTR, the date, the account) on the lead.`,
      });
    },
  });
}

async function closeWithNote(
  a: EnrollmentAccess,
  id: string,
  rawNote: string,
  o: {
    from: EnrollmentStatus[];
    to: EnrollmentStatus;
    type: "ENROLLMENT_SENT_BACK" | "ENROLLMENT_NOT_RECEIVED";
    summary: (note: string) => string;
    notify: (e: Row, note: string) => Promise<void>;
  },
) {
  const note = rawNote.trim().slice(0, 500);
  if (note.length < 3) throw badRequest("Say what's wrong, so the BDE knows what to fix.", "note_required");
  const e = await prisma.crmEnrollment.findUnique({ where: { id }, select: ROW });
  if (!e) throw notFound("Enrollment not found.");
  const res = await prisma.crmEnrollment.updateMany({ where: { id, status: { in: o.from } }, data: { status: o.to, financeNote: note } });
  if (res.count !== 1) throw conflict("This enrollment changed meanwhile. Reload it.", "enrollment_changed");
  await recordLeadActivity({ leadId: e.leadId, actorId: a.userId, type: o.type, summary: o.summary(note), metadata: { enrollmentId: id, note } });
  await recordAudit({ entityType: "CrmEnrollment", entityId: id, action: "UPDATE", userId: a.userId, changes: { status: { from: e.status, to: o.to }, note } });
  await o.notify(e, note);
  return { status: o.to };
}
