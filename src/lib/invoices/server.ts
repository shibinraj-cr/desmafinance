import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUserAndPermissions } from "@/lib/permissions";
import { canSeePage, type Permissions } from "@/lib/rbac";
import { HttpError, badRequest, conflict, forbidden, notFound, unauthorized } from "@/lib/http-error";
import { recordAudit } from "@/lib/audit";
import { fromPrismaDate, toPrismaDate, todayIst } from "@/lib/lead-pulse-dates";
import { getCrmAccess } from "@/lib/crm-rbac";
import { getOpsAccess } from "@/lib/ops-rbac";
import { STAMP_FONT_PUBLIC_PATH } from "@/lib/esign/font";
import {
  FY_STYLES,
  GST_RATE_PCT,
  INVOICE_BANKS,
  INVOICE_ENTITIES,
  NOT_INVOICEABLE_MESSAGE,
  SERIES_KEYS,
  amountInWords,
  billToLines,
  computeInvoiceAmounts,
  effectiveKind,
  formatInvoiceNo,
  fyCode,
  isGstin,
  isIndia,
  isSeriesNumber,
  nextSeq,
  notInvoiceableReason,
  restyleNumber,
  round2,
  seriesKeyFor,
  seriesStem,
  setupGaps,
  type AmountsProblem,
  type FyStyle,
  type InvoiceEntityCode,
  type InvoiceKind,
} from "./core";
import { gstStateByName, gstStateOfGstin, placeOfSupplyLabel } from "./gst-states";
import { buildCandidateInvoicePdf, stampWatermark, type InvoicePdfInput } from "./pdf";
import { lockLedgerRow } from "./ledger-lock";
import { advisoryLock, lockInvoiceStem } from "./numbering";

/**
 * Candidate invoices: who may do what, Invoice settings, issuing (number,
 * PDF, freeze), cancelling, downloads, and the lead's Transactions view.
 * Pure rules are in core.ts; the PDF layout in pdf.ts.
 */

export const INVOICES_PAGE = "/finance/invoices";
const STARTS_ON_KEY = "invoices_start_on";

type Db = Prisma.TransactionClient | typeof prisma;

// ── access ───────────────────────────────────────────────────────────────────

export type InvoiceAccess = { userId: string; perms: Permissions; isFinance: boolean; canManage: boolean };

/**
 * Finance (anyone with the Invoices page) lists and issues invoices. Settings
 * and cancelling are for approvers (Finance Manager) and admins.
 */
export async function getInvoiceAccess(): Promise<InvoiceAccess | null> {
  const { perms, userId } = await getCurrentUserAndPermissions();
  if (!perms || !userId) return null;
  const isFinance = canSeePage(perms, INVOICES_PAGE);
  return { userId, perms, isFinance, canManage: isFinance && (perms.isAdmin || perms.canApprove) };
}

export async function requireInvoiceAccess(need: "finance" | "manage"): Promise<InvoiceAccess> {
  const a = await getInvoiceAccess();
  if (!a) throw unauthorized();
  if (!a.isFinance) throw forbidden("You don't have access to Invoices.");
  if (need === "manage" && !a.canManage) throw forbidden("Only a Finance Manager or Admin can do this.");
  return a;
}

/**
 * How someone outside Finance may see a candidate's payments and invoices:
 * the BDE a lead of theirs is assigned to, CRM admins and supervisors, and
 * the Ops person handling one of their projects (Ops managers see all).
 * Null = not at all. Bank references stay with Finance.
 */
export async function partyViewerAccess(
  userId: string,
  perms: Permissions,
  partyId: string,
): Promise<"finance" | "crm" | "ops" | null> {
  if (canSeePage(perms, INVOICES_PAGE)) return "finance";
  // Outside Finance, only candidates' money: never a partner institution's or a vendor's.
  const party = await prisma.party.findUnique({ where: { id: partyId }, select: { group: true } });
  if (party?.group !== "Candidate") return null;
  const crm = await getCrmAccess(userId, perms);
  if (crm.isAdmin || crm.isSupervisor || crm.canManageCrm) return "crm";
  if (crm.canViewLeads && (await prisma.lead.count({ where: { partyId, assignedToId: userId } })) > 0) return "crm";
  const ops = getOpsAccess(userId, perms);
  if (ops.isOpsManager) return "ops";
  if (ops.isOpsUser && (await prisma.opsProject.count({ where: { partyId, assignedToId: userId } })) > 0) return "ops";
  return null;
}

// ── settings ─────────────────────────────────────────────────────────────────

export async function getStartsOn(db: Db = prisma): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key: STARTS_ON_KEY } });
  return row && /^\d{4}-\d{2}-\d{2}$/.test(row.value) ? row.value : null;
}

const ENTITY_FIELDS = {
  code: true,
  legalName: true,
  headerLines: true,
  signFor: true,
  thanksLine: true,
  gstin: true,
  sacCode: true,
  lutArn: true,
  note: true,
  signatoryName: true,
  signatureMime: true,
  updatedAt: true,
} satisfies Prisma.InvoiceEntitySelect;

export async function loadSettings(db: Db = prisma) {
  const [entities, banks, series, startsOn] = await Promise.all([
    db.invoiceEntity.findMany({ select: ENTITY_FIELDS, orderBy: { code: "asc" } }),
    db.invoiceBank.findMany({ orderBy: { paymentMode: "asc" } }),
    db.invoiceSeries.findMany({ orderBy: { key: "asc" } }),
    getStartsOn(db),
  ]);
  return {
    entities: entities.map(({ signatureMime, updatedAt, ...e }) => ({
      ...e,
      hasSignature: !!signatureMime,
      updatedAt: updatedAt.toISOString(),
    })),
    banks: banks.map((b) => ({ paymentMode: b.paymentMode, entityCode: b.entityCode, details: b.details, isActive: b.isActive })),
    series: series.map((s) => ({ key: s.key, prefix: s.prefix, fyStyle: s.fyStyle as FyStyle, padding: s.padding, nextNumber: s.nextNumber })),
    startsOn,
  };
}
export type InvoiceSettings = Awaited<ReturnType<typeof loadSettings>>;

function text(v: unknown, max: number, label: string): string {
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  if (s.length > max) throw badRequest(`${label} is too long (${max} characters at most).`);
  return s;
}

export type EntityPatch = Partial<{
  legalName: string;
  headerLines: string;
  signFor: string;
  thanksLine: string;
  gstin: string | null;
  sacCode: string;
  lutArn: string | null;
  note: string;
  signatoryName: string;
}>;

export async function saveEntity(a: InvoiceAccess, code: string, patch: EntityPatch) {
  if (!(INVOICE_ENTITIES as readonly string[]).includes(code)) throw notFound();
  const data: Prisma.InvoiceEntityUpdateInput = { updatedById: a.userId };
  if (patch.legalName !== undefined) data.legalName = text(patch.legalName, 120, "Legal name");
  if (patch.headerLines !== undefined) data.headerLines = text(patch.headerLines, 600, "Address lines");
  if (patch.signFor !== undefined) data.signFor = text(patch.signFor, 120, "The \"For …\" line");
  if (patch.thanksLine !== undefined) data.thanksLine = text(patch.thanksLine, 160, "The thank-you line");
  if (patch.note !== undefined) data.note = text(patch.note, 400, "The note");
  if (patch.signatoryName !== undefined) data.signatoryName = text(patch.signatoryName, 80, "Signatory name");
  if (patch.gstin !== undefined) {
    const g = text(patch.gstin ?? "", 15, "GSTIN").toUpperCase();
    if (g && code !== "DIPL") throw badRequest("Only the India company has a GSTIN.");
    if (g && !isGstin(g)) throw badRequest("That doesn't look like a GSTIN (15 characters, e.g. 32ABCDE1234F1Z5).");
    if (g && !gstStateOfGstin(g)) throw badRequest("The GSTIN's first two digits aren't a state code.");
    data.gstin = g || null;
  }
  if (patch.sacCode !== undefined) {
    const s = text(patch.sacCode, 8, "SAC code");
    if (s && !/^\d{4,8}$/.test(s)) throw badRequest("The SAC code is 4 to 8 digits, e.g. 998311.");
    data.sacCode = s;
  }
  if (patch.lutArn !== undefined) data.lutArn = text(patch.lutArn ?? "", 40, "LUT ARN") || null;
  await prisma.invoiceEntity.update({ where: { code }, data });
  await recordAudit({ entityType: "InvoiceEntity", entityId: code, action: "UPDATE", userId: a.userId, changes: patch });
}

export async function saveEntitySignature(a: InvoiceAccess, code: string, bytes: Uint8Array | null, mime: string | null) {
  if (!(INVOICE_ENTITIES as readonly string[]).includes(code)) throw notFound();
  if (bytes) {
    if (mime !== "image/png" && mime !== "image/jpeg") throw badRequest("Upload the signature as a PNG or JPEG image.");
    if (bytes.byteLength > 300 * 1024) throw badRequest("The signature image is too large (300 KB at most).");
  }
  await prisma.invoiceEntity.update({
    where: { code },
    data: { signaturePng: bytes ? Buffer.from(bytes) : null, signatureMime: bytes ? mime : null, updatedById: a.userId },
  });
  await recordAudit({ entityType: "InvoiceEntity", entityId: code, action: "UPDATE", userId: a.userId, changes: { signature: bytes ? "replaced" : "removed" } });
}

export async function saveBank(a: InvoiceAccess, paymentMode: string, patch: { details?: string; isActive?: boolean; entityCode?: string }) {
  if (!(INVOICE_BANKS as readonly string[]).includes(paymentMode)) throw notFound();
  const data: Prisma.InvoiceBankUpdateInput = { updatedById: a.userId };
  if (patch.details !== undefined) data.details = text(patch.details, 500, "Bank details");
  if (patch.isActive !== undefined) data.isActive = !!patch.isActive;
  if (patch.entityCode !== undefined) {
    if (!(INVOICE_ENTITIES as readonly string[]).includes(patch.entityCode)) throw badRequest("Pick the company that invoices this bank's payments.");
    data.entityCode = patch.entityCode;
  }
  await prisma.invoiceBank.update({ where: { paymentMode }, data });
  await recordAudit({ entityType: "InvoiceBank", entityId: paymentMode, action: "UPDATE", userId: a.userId, changes: patch });
}

export async function saveSeries(
  a: InvoiceAccess,
  key: string,
  patch: { prefix?: string; fyStyle?: string; padding?: number; nextNumber?: string | null },
) {
  if (!(SERIES_KEYS as readonly string[]).includes(key)) throw notFound();
  // The same lock as issuing in this series: a new floor or format applies
  // to the next issue, never to one already working out its number.
  await prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `invoice-series:${key}`);
    await saveSeriesLocked(tx, a, key, patch);
  });
  await recordAudit({ entityType: "InvoiceSeries", entityId: key, action: "UPDATE", userId: a.userId, changes: patch });
}

async function saveSeriesLocked(
  tx: Prisma.TransactionClient,
  a: InvoiceAccess,
  key: string,
  patch: { prefix?: string; fyStyle?: string; padding?: number; nextNumber?: string | null },
) {
  const current = await tx.invoiceSeries.findUnique({ where: { key } });
  if (!current) throw notFound();
  const prefix = patch.prefix !== undefined ? text(patch.prefix, 12, "Prefix").toUpperCase() : current.prefix;
  if (!/^[A-Z0-9][A-Z0-9/-]*\/$/.test(prefix)) throw badRequest('The prefix ends with "/", e.g. D/DIPL/.');
  if (await tx.invoiceSeries.findFirst({ where: { key: { not: key }, prefix } })) {
    throw badRequest(`Another series already uses ${prefix}. Each series needs its own prefix.`);
  }
  const fyStyle = (patch.fyStyle ?? current.fyStyle) as FyStyle;
  if (!(FY_STYLES as readonly string[]).includes(fyStyle)) throw badRequest("Pick how the year is written.");
  const padding = patch.padding ?? current.padding;
  if (!Number.isInteger(padding) || padding < 1 || padding > 6) throw badRequest("The running number has 1 to 6 digits.");
  const typed = patch.nextNumber === undefined ? undefined : text(patch.nextNumber ?? "", 30, "Next number").toUpperCase() || null;
  let nextNumber = typed === undefined ? current.nextNumber : typed;
  if (nextNumber && nextNumber === current.nextNumber) {
    // Left as it was while the format changed: carry the floor over,
    // D/DIPL/26-27/0526 → D/DIPL/2627/0526.
    nextNumber = restyleNumber(nextNumber, { prefix: current.prefix, fyStyle: current.fyStyle as FyStyle }, { prefix, fyStyle, padding }) ?? nextNumber;
  }
  if (nextNumber && !isSeriesNumber(prefix, fyStyle, nextNumber)) {
    throw badRequest(`The next number must follow the series, e.g. ${formatInvoiceNo(seriesStem(prefix, todayIst(), fyStyle), 1, padding)}.`);
  }
  await tx.invoiceSeries.update({ where: { key }, data: { prefix, fyStyle, padding, nextNumber, updatedById: a.userId } });
}

export async function saveStartsOn(a: InvoiceAccess, value: string | null) {
  const v = (value ?? "").trim();
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw badRequest("Pick a date.");
  if (v) {
    await prisma.appSetting.upsert({
      where: { key: STARTS_ON_KEY },
      create: { key: STARTS_ON_KEY, value: v, updatedById: a.userId },
      update: { value: v, updatedById: a.userId },
    });
  } else {
    await prisma.appSetting.deleteMany({ where: { key: STARTS_ON_KEY } });
  }
  await recordAudit({ entityType: "InvoiceSettings", entityId: STARTS_ON_KEY, action: "UPDATE", userId: a.userId, changes: { startsOn: v || null } });
}

// ── what can be invoiced ─────────────────────────────────────────────────────

const PARTY_BILLING = {
  id: true,
  name: true,
  group: true,
  billingName: true,
  billingAddress: true,
  billingPin: true,
  billingState: true,
  billingCountry: true,
} satisfies Prisma.PartySelect;

/** Payments waiting for an invoice: approved, into an active invoicing bank, from the cut-over on. */
export async function listToInvoice() {
  const settings = await loadSettings();
  const activeBanks = settings.banks.filter((b) => b.isActive).map((b) => b.paymentMode);
  if (!settings.startsOn || activeBanks.length === 0) return { startsOn: settings.startsOn, rows: [] };
  const rows = await prisma.transaction.findMany({
    where: {
      type: "Revenue",
      deletedAt: null,
      isHistorical: false,
      category: { not: "Commissions" },
      paymentMode: { in: activeBanks },
      date: { gte: toPrismaDate(settings.startsOn) },
      party: { group: "Candidate" },
      invoices: { none: { status: "issued" } },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    take: 300,
    select: {
      id: true,
      date: true,
      amount: true,
      paymentMode: true,
      category: true,
      subItem: true,
      description: true,
      expDom: true,
      pendingApprovals: { where: { status: "pending", kind: { in: ["update", "delete"] } }, select: { kind: true }, take: 1 },
      party: {
        select: {
          ...PARTY_BILLING,
          leads: {
            select: { id: true, country: true, assignedTo: { select: { username: true, leadPulseRole: { select: { displayName: true } } } } },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  return {
    startsOn: settings.startsOn,
    rows: rows.map((r) => ({
      id: r.id,
      date: fromPrismaDate(r.date),
      amount: Number(r.amount),
      paymentMode: r.paymentMode,
      category: r.category,
      subItem: r.subItem,
      description: r.description,
      expDom: r.expDom,
      /** An edit or deletion of this payment waiting for approval: settle it before invoicing. */
      pendingChange: r.pendingApprovals[0]?.kind ?? null,
      entityCode: settings.banks.find((b) => b.paymentMode === r.paymentMode)?.entityCode ?? null,
      party: r.party
        ? {
            id: r.party.id,
            name: r.party.name,
            billingName: r.party.billingName,
            billingAddress: r.party.billingAddress,
            billingPin: r.party.billingPin,
            billingState: r.party.billingState,
            billingCountry: r.party.billingCountry,
            leadId: r.party.leads[0]?.id ?? null,
            leadCountry: r.party.leads[0]?.country ?? null,
            bde: r.party.leads[0]?.assignedTo?.leadPulseRole?.displayName ?? r.party.leads[0]?.assignedTo?.username ?? null,
          }
        : null,
    })),
  };
}
export type ToInvoiceRow = Awaited<ReturnType<typeof listToInvoice>>["rows"][number];

// ── numbering ────────────────────────────────────────────────────────────────

type SeriesRow = InvoiceSettings["series"][number];

/**
 * The next number in a series for the invoice date's financial year. One
 * above the highest already issued in that series and year (a change of
 * prefix or year style mid-year continues the count), never below the
 * series' "next number" floor, and clear of numbers Partner Commissions has
 * used in the same stem (D/DLLC is one series shared by both).
 */
async function nextNumber(db: Db, given: SeriesRow, invoiceDate: string, lock: boolean) {
  const fy = fyCode(invoiceDate, "dash");
  let series = given;
  if (lock) {
    const tx = db as Prisma.TransactionClient;
    await advisoryLock(tx, `invoice-series:${given.key}`);
    // Read the series again now it's locked: a floor or format saved a moment
    // ago must apply to this number.
    const fresh = await tx.invoiceSeries.findUnique({ where: { key: given.key } });
    if (fresh) series = { key: fresh.key, prefix: fresh.prefix, fyStyle: fresh.fyStyle as FyStyle, padding: fresh.padding, nextNumber: fresh.nextNumber };
  }
  const stem = seriesStem(series.prefix, invoiceDate, series.fyStyle);
  if (lock) await lockInvoiceStem(db as Prisma.TransactionClient, stem);
  const [maxSeq, pcNumbers, pc] = await Promise.all([
    db.invoice.aggregate({ where: { seriesKey: series.key, fy }, _max: { seq: true } }),
    db.commissionInvoice.findMany({ where: { number: { startsWith: stem, mode: "insensitive" } }, select: { number: true } }),
    db.commissionSettings.findUnique({ where: { id: "default" }, select: { nextNumber: true } }),
  ]);
  const seq = Math.max(
    (maxSeq._max.seq ?? 0) + 1,
    nextSeq(stem, pcNumbers.map((n) => n.number.toUpperCase()), [series.nextNumber, pc?.nextNumber?.toUpperCase()]),
  );
  return { number: formatInvoiceNo(stem, seq, series.padding), seq, fy, series };
}

/** What each series would issue next today, for Settings. */
export async function upcomingNumbers(): Promise<Record<string, string>> {
  const settings = await loadSettings();
  const today = todayIst();
  const out: Record<string, string> = {};
  for (const s of settings.series) out[s.key] = (await nextNumber(prisma, s, today, false)).number;
  return out;
}

// ── issuing ──────────────────────────────────────────────────────────────────

export type IssueInput = {
  transactionId: string;
  kind: InvoiceKind;
  invoiceDate: string;
  description: string;
  intakeMonth: string | null;
  billTo: { name: string; address: string; pin: string; state: string | null; country: string };
  saveToParty: boolean;
  foreign: { currency: string; amount: number } | null;
};

const AMOUNT_PROBLEM: Record<AmountsProblem, string> = {
  amount_not_positive: "The payment amount must be more than zero.",
  foreign_amount_required: "Enter the amount the candidate paid in that currency.",
  foreign_currency_invalid: "Enter a three-letter currency code other than INR, e.g. CAD.",
  foreign_not_allowed: "A domestic invoice is in rupees. Pick EXP for a foreign-currency invoice.",
};

let assets: Promise<{ logo: Uint8Array; font: Uint8Array }> | null = null;
/**
 * Logo and Noto Sans from public/, traced into the issuing routes by
 * next.config.mjs. Missing files stop the issue: an invoice is stored once,
 * so one printed without its logo or ₹ would stay that way.
 */
function loadAssets(): Promise<{ logo: Uint8Array; font: Uint8Array }> {
  const read = (p: string) => readFile(path.join(process.cwd(), "public", p)).then((b) => new Uint8Array(b));
  assets ??= Promise.all([read("desma-logo.png"), read(STAMP_FONT_PUBLIC_PATH)]).then(([logo, font]) => ({ logo, font }));
  return assets.catch(() => {
    assets = null;
    throw new HttpError(503, "The invoice template files (logo, font) are missing on the server, so nothing was issued. Tell an admin.", "template_missing");
  });
}

type Prepared = {
  ledger: { id: string; partyId: string; expDom: string | null; paymentMode: string };
  entityCode: InvoiceEntityCode;
  kind: InvoiceKind;
  series: SeriesRow;
  amounts: Exclude<ReturnType<typeof computeInvoiceAmounts>, { problem: AmountsProblem }>;
  placeOfSupply: string | null;
  billTo: IssueInput["billTo"];
  pdf: Omit<InvoicePdfInput, "number">;
};

/** Check everything about an issue request and build what the PDF prints. No writes. */
async function prepare(db: Db, input: IssueInput, settings: InvoiceSettings): Promise<Prepared> {
  const t = await db.transaction.findUnique({
    where: { id: input.transactionId },
    select: {
      id: true,
      type: true,
      deletedAt: true,
      isHistorical: true,
      category: true,
      paymentMode: true,
      date: true,
      amount: true,
      expDom: true,
      partyId: true,
      party: { select: { group: true } },
    },
  });
  if (!t) throw notFound();
  const activeBanks = settings.banks.filter((b) => b.isActive).map((b) => b.paymentMode);
  const why = notInvoiceableReason(
    { ...t, date: fromPrismaDate(t.date), partyGroup: t.party?.group ?? null },
    { activeBanks, startsOn: settings.startsOn },
  );
  if (why) throw badRequest(NOT_INVOICEABLE_MESSAGE[why], why);
  const live = await db.invoice.findFirst({ where: { transactionId: t.id, status: "issued" }, select: { number: true } });
  if (live) throw conflict(`Invoice ${live.number} is already issued for this payment.`, "already_invoiced");
  const pendingChange = await db.pendingApproval.findFirst({
    where: { targetTxId: t.id, status: "pending", kind: { in: ["update", "delete"] } },
    select: { kind: true },
  });
  if (pendingChange) {
    throw conflict(
      `A ${pendingChange.kind === "delete" ? "deletion" : "change"} of this payment is waiting for approval. Approve or reject it first, then issue the invoice.`,
      "pending_change",
    );
  }

  const bank = settings.banks.find((b) => b.paymentMode === t.paymentMode)!;
  const entityCode = bank.entityCode as InvoiceEntityCode;
  const entity = await db.invoiceEntity.findUnique({ where: { code: entityCode } });
  const kind = effectiveKind(entityCode, input.kind);
  const series = settings.series.find((s) => s.key === seriesKeyFor(entityCode, kind)) ?? null;
  const gaps = setupGaps(entity ? { ...entity, hasSignature: !!entity.signaturePng } : null, bank, series);
  if (gaps.length || !entity || !series) {
    throw badRequest(`Finish Invoice settings first: ${gaps.join("; ")}.`, "settings_incomplete");
  }

  const name = text(input.billTo.name, 120, "Name");
  if (!name) throw badRequest("Enter the candidate's name as on the passport.");
  const address = text(input.billTo.address, 400, "Address");
  if (!address) throw badRequest("Enter the candidate's address.");
  const country = text(input.billTo.country, 60, "Country") || "India";
  const pin = text(input.billTo.pin, 12, "PIN");
  const stateName = text(input.billTo.state ?? "", 60, "State");
  const state = isIndia(country) ? gstStateByName(stateName) : null;
  if (isIndia(country) && stateName && !state) throw badRequest("Pick the state from the list.");
  const billTo = { name, address, pin, state: state?.name ?? (stateName || null), country };

  let placeOfSupply: string | null = null;
  let sameState = false;
  if (entityCode === "DIPL" && kind === "DOM") {
    if (!isIndia(country)) throw badRequest("A domestic invoice needs an address in India. For a candidate abroad, issue an export (EXP) invoice.");
    if (!state) throw badRequest("Pick the candidate's state: it decides CGST + SGST or IGST.");
    const home = gstStateOfGstin(entity.gstin)!;
    sameState = state.code === home.code;
    placeOfSupply = placeOfSupplyLabel(state);
  }

  if (entityCode === "DLLC" && input.foreign && input.foreign.currency.trim().toUpperCase() !== "AED") {
    throw badRequest("Wio invoices are in AED.", "foreign_currency_invalid");
  }
  const amounts = computeInvoiceAmounts({
    entity: entityCode,
    kind,
    receivedInr: Number(t.amount),
    sameState,
    foreign: input.foreign,
  });
  if ("problem" in amounts) throw badRequest(AMOUNT_PROBLEM[amounts.problem], amounts.problem);

  const paidOn = fromPrismaDate(t.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate)) throw badRequest("Pick the invoice date.");
  if (input.invoiceDate < paidOn) throw badRequest("The invoice can't be dated before the payment arrived.");
  if (input.invoiceDate > todayIst()) throw badRequest("The invoice date can't be in the future.");
  const description = text(input.description, 200, "Description");
  if (!description) throw badRequest("Describe what the payment is for, e.g. AHPRA 2nd Instalment of Initial Payment.");
  const intakeMonth = kind === "EXP" ? text(input.intakeMonth ?? "", 20, "Intake month") || null : null;

  const layout = entityCode === "DLLC" ? "dllc" : kind === "EXP" ? "dipl-exp" : "dipl-dom";
  const lutLine =
    layout === "dipl-exp" && entity.lutArn
      ? `Supply meant for export under Letter of Undertaking (ARN ${entity.lutArn}) without payment of integrated tax.`
      : null;
  const { logo, font } = await loadAssets();
  return {
    ledger: { id: t.id, partyId: t.partyId!, expDom: t.expDom, paymentMode: t.paymentMode },
    entityCode,
    kind,
    series,
    amounts,
    placeOfSupply,
    billTo,
    pdf: {
      layout,
      title: kind === "EXP" ? "Export Invoice" : "Domestic Invoice",
      invoiceDate: input.invoiceDate,
      paymentTerm: "Immediate",
      currency: amounts.currency,
      issuer: {
        legalName: entity.legalName,
        headerLines: entity.headerLines,
        signFor: entity.signFor,
        thanksLine: entity.thanksLine,
        signatoryName: entity.signatoryName,
      },
      billTo: { name, lines: billToLines(billTo) },
      description,
      intakeMonth,
      hsn: layout === "dipl-dom" ? entity.sacCode : null,
      amount: layout === "dipl-dom" ? amounts.taxable : amounts.total,
      tax: layout === "dipl-dom" ? { cgst: amounts.cgst, sgst: amounts.sgst, igst: amounts.igst, ratePct: GST_RATE_PCT } : null,
      total: amounts.total,
      receivedInr: amounts.receivedInr,
      words: amountInWords(amounts.total, amounts.currency),
      note: entity.note,
      bankLines: bank.details.split(/\n/).map((l) => l.trim()).filter(Boolean),
      lutLine,
      placeOfSupply,
      signature: entity.signaturePng && entity.signatureMime ? { bytes: new Uint8Array(entity.signaturePng), mime: entity.signatureMime } : null,
      logoPng: logo,
      unicodeFont: font,
    },
  };
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** The PDF as it would be issued, stamped PREVIEW, with the number it would most likely get. */
export async function previewInvoice(input: IssueInput): Promise<{ pdf: Uint8Array; number: string }> {
  const settings = await loadSettings();
  const p = await prepare(prisma, input, settings);
  const { number } = await nextNumber(prisma, p.series, input.invoiceDate, false);
  const pdf = await buildCandidateInvoicePdf({ ...p.pdf, number });
  return { pdf: await stampWatermark(pdf, "PREVIEW", "Preview: not issued. The number is assigned when the invoice is issued."), number };
}

/**
 * Issue the invoice for one approved payment. In one database transaction:
 * lock the ledger row (an edit can't slip in between), re-check everything,
 * take the next number, render and store the PDF, and record the invoice.
 * On a DIPL invoice the ledger row's EXP/DOM follows the invoice.
 */
export async function issueInvoice(a: InvoiceAccess, input: IssueInput): Promise<{ id: string; number: string }> {
  await loadAssets(); // fail before taking any lock if the template files are missing
  const issued = await prisma.$transaction(
    async (tx) => {
      await lockLedgerRow(tx, input.transactionId);
      const settings = await loadSettings(tx);
      const p = await prepare(tx, input, settings);
      const n = await nextNumber(tx, p.series, input.invoiceDate, true);
      const pdf = await buildCandidateInvoicePdf({ ...p.pdf, number: n.number });
      const inv = await tx.invoice.create({
        data: {
          number: n.number,
          seriesKey: n.series.key,
          fy: n.fy,
          seq: n.seq,
          kind: p.kind,
          entityCode: p.entityCode,
          invoiceDate: toPrismaDate(input.invoiceDate),
          transactionId: p.ledger.id,
          partyId: p.ledger.partyId,
          paymentMode: p.ledger.paymentMode,
          currency: p.amounts.currency,
          taxableAmount: p.amounts.taxable,
          cgst: p.amounts.cgst,
          sgst: p.amounts.sgst,
          igst: p.amounts.igst,
          totalAmount: p.amounts.total,
          receivedInr: p.amounts.receivedInr,
          exchangeRate: p.amounts.exchangeRate,
          billToName: p.billTo.name,
          billToAddress: p.pdf.billTo.lines.join("\n"),
          placeOfSupply: p.placeOfSupply,
          description: p.pdf.description,
          snapshot: {
            layout: p.pdf.layout,
            title: p.pdf.title,
            issuer: p.pdf.issuer,
            hsn: p.pdf.hsn,
            intakeMonth: p.pdf.intakeMonth,
            note: p.pdf.note,
            bankLines: p.pdf.bankLines,
            lutLine: p.pdf.lutLine,
            words: p.pdf.words,
          },
          issuedById: a.userId,
        },
        select: { id: true, number: true },
      });
      await tx.invoiceFile.create({ data: { invoiceId: inv.id, kind: "original", bytes: Buffer.from(pdf), sha256: sha256(pdf) } });
      if (p.entityCode === "DIPL" && p.ledger.expDom !== p.kind) {
        await tx.transaction.update({ where: { id: p.ledger.id }, data: { expDom: p.kind } });
      }
      if (input.saveToParty) {
        await tx.party.update({
          where: { id: p.ledger.partyId },
          data: {
            billingName: p.billTo.name,
            billingAddress: p.billTo.address,
            billingPin: p.billTo.pin || null,
            billingState: p.billTo.state,
            billingCountry: p.billTo.country,
          },
        });
      }
      return { ...inv, expDomChanged: p.entityCode === "DIPL" && p.ledger.expDom !== p.kind ? { from: p.ledger.expDom, to: p.kind } : null };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );
  await recordAudit({
    entityType: "Invoice",
    entityId: issued.id,
    action: "CREATE",
    userId: a.userId,
    changes: { number: issued.number, transactionId: input.transactionId, kind: input.kind, expDomChanged: issued.expDomChanged },
  });
  if (issued.expDomChanged) {
    // Finance decides EXP/DOM when it invoices; the ledger row's own history says so.
    await recordAudit({
      entityType: "Transaction",
      entityId: input.transactionId,
      action: "UPDATE",
      userId: a.userId,
      changes: { before: { expDom: issued.expDomChanged.from }, after: { expDom: issued.expDomChanged.to }, reason: `GST invoice ${issued.number} issued as ${issued.expDomChanged.to}` },
    });
  }
  return { id: issued.id, number: issued.number };
}

// ── cancelling ───────────────────────────────────────────────────────────────

function slashDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Cancel an issued invoice. Its number stays used (shown as cancelled in the
 * register); the stored PDF is kept and a copy stamped CANCELLED is added.
 * The ledger row is free to edit again, and a new invoice can be issued.
 * Once its month is in a filed GSTR-1, ask the CA: a credit note may be needed.
 */
export async function cancelInvoice(a: InvoiceAccess, id: string, reason: string) {
  const why = text(reason, 300, "Reason");
  if (why.length < 5) throw badRequest("Say why the invoice is being cancelled.");
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { id: true, number: true, status: true, transactionId: true, files: { where: { kind: "original" }, select: { bytes: true } } },
  });
  if (!inv) throw notFound();
  if (inv.status !== "issued") throw conflict("That invoice is already cancelled.", "already_cancelled");
  const original = inv.files[0]?.bytes;
  if (!original) throw conflict("The invoice file is missing; contact an admin.", "file_missing");
  const stamped = await stampWatermark(new Uint8Array(original), "CANCELLED", `CANCELLED on ${slashDate(todayIst())}: ${why}`);
  await prisma.$transaction(async (tx) => {
    await lockLedgerRow(tx, inv.transactionId);
    const { count } = await tx.invoice.updateMany({
      where: { id, status: "issued" },
      data: { status: "cancelled", cancelledAt: new Date(), cancelledById: a.userId, cancelReason: why },
    });
    if (count !== 1) throw conflict("That invoice was just cancelled by someone else.", "already_cancelled");
    await tx.invoiceFile.create({ data: { invoiceId: id, kind: "cancelled", bytes: Buffer.from(stamped), sha256: sha256(stamped) } });
  });
  await recordAudit({ entityType: "Invoice", entityId: id, action: "CANCEL", userId: a.userId, changes: { number: inv.number, reason: why } });
}

// ── reading ──────────────────────────────────────────────────────────────────

/** "D/DIPL/26-27/0525" → "D-DIPL-26-27-0525.pdf" */
export function invoiceFileName(number: string, cancelled = false): string {
  const base = number.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "invoice";
  return `${base}${cancelled ? "-CANCELLED" : ""}.pdf`;
}

/** The stored file for a download, after checking the viewer may have it. Logs every download. */
export async function invoiceDownload(userId: string, perms: Permissions, id: string) {
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { id: true, number: true, status: true, partyId: true } });
  if (!inv) throw notFound();
  const via = canSeePage(perms, INVOICES_PAGE) ? "finance" : inv.partyId ? await partyViewerAccess(userId, perms, inv.partyId) : null;
  if (!via) throw forbidden("You can download invoices for your own candidates only.");
  const cancelled = inv.status === "cancelled";
  const file =
    (cancelled ? await prisma.invoiceFile.findUnique({ where: { invoiceId_kind: { invoiceId: id, kind: "cancelled" } } }) : null) ??
    (await prisma.invoiceFile.findUnique({ where: { invoiceId_kind: { invoiceId: id, kind: "original" } } }));
  if (!file) throw notFound();
  await recordAudit({ entityType: "Invoice", entityId: id, action: "DOWNLOAD", userId, changes: { number: inv.number, via } });
  return { bytes: new Uint8Array(file.bytes), filename: invoiceFileName(inv.number, cancelled) };
}

const INVOICE_LIST_SELECT = {
  id: true,
  number: true,
  seriesKey: true,
  kind: true,
  entityCode: true,
  status: true,
  invoiceDate: true,
  paymentMode: true,
  currency: true,
  taxableAmount: true,
  cgst: true,
  sgst: true,
  igst: true,
  totalAmount: true,
  receivedInr: true,
  exchangeRate: true,
  billToName: true,
  placeOfSupply: true,
  description: true,
  transactionId: true,
  partyId: true,
  issuedAt: true,
  cancelledAt: true,
  cancelReason: true,
  issuedBy: { select: { username: true } },
  cancelledBy: { select: { username: true } },
} satisfies Prisma.InvoiceSelect;

function serializeInvoice(i: Prisma.InvoiceGetPayload<{ select: typeof INVOICE_LIST_SELECT }>) {
  return {
    id: i.id,
    number: i.number,
    seriesKey: i.seriesKey,
    kind: i.kind,
    entityCode: i.entityCode,
    status: i.status,
    invoiceDate: fromPrismaDate(i.invoiceDate),
    paymentMode: i.paymentMode,
    currency: i.currency,
    taxable: Number(i.taxableAmount),
    cgst: Number(i.cgst),
    sgst: Number(i.sgst),
    igst: Number(i.igst),
    total: Number(i.totalAmount),
    receivedInr: Number(i.receivedInr),
    exchangeRate: Number(i.exchangeRate),
    billToName: i.billToName,
    placeOfSupply: i.placeOfSupply,
    description: i.description,
    transactionId: i.transactionId,
    partyId: i.partyId,
    issuedAt: i.issuedAt.toISOString(),
    issuedBy: i.issuedBy?.username ?? null,
    cancelledAt: i.cancelledAt?.toISOString() ?? null,
    cancelledBy: i.cancelledBy?.username ?? null,
    cancelReason: i.cancelReason,
  };
}
export type InvoiceDTO = ReturnType<typeof serializeInvoice>;

function monthRange(month: string): { gte: Date; lt: Date } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { gte: toPrismaDate(`${month}-01`), lt: toPrismaDate(next) };
}

/** The register: invoices by invoice month, newest first. */
export async function listInvoices(f: { month?: string | null; series?: string | null; status?: string | null; q?: string | null }) {
  const range = f.month ? monthRange(f.month) : null;
  const q = (f.q ?? "").trim();
  const rows = await prisma.invoice.findMany({
    where: {
      ...(range ? { invoiceDate: range } : {}),
      ...(f.series && (SERIES_KEYS as readonly string[]).includes(f.series) ? { seriesKey: f.series } : {}),
      ...(f.status === "issued" || f.status === "cancelled" ? { status: f.status } : {}),
      ...(q
        ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { billToName: { contains: q, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: [{ invoiceDate: "desc" }, { number: "desc" }],
    take: range ? 2000 : 300,
    select: INVOICE_LIST_SELECT,
  });
  return rows.map(serializeInvoice);
}

/**
 * Candidate payments in a month that carry no invoice, for the CA: Cash, UPI,
 * cards, RCS, STR (recorded, never invoiced, by decision) and bank payments
 * still waiting for Finance to invoice them.
 */
export async function listNotInvoiced(month: string) {
  const range = monthRange(month);
  if (!range) throw badRequest("Pick a month.");
  const settings = await loadSettings();
  const activeBanks = settings.banks.filter((b) => b.isActive).map((b) => b.paymentMode);
  const rows = await prisma.transaction.findMany({
    where: {
      type: "Revenue",
      deletedAt: null,
      isHistorical: false,
      category: { not: "Commissions" },
      date: range,
      party: { group: "Candidate" },
      invoices: { none: { status: "issued" } },
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: { id: true, date: true, amount: true, paymentMode: true, category: true, subItem: true, party: { select: { id: true, name: true } } },
  });
  return rows.map((r) => {
    const date = fromPrismaDate(r.date);
    const why = notInvoiceableReason(
      { type: "Revenue", deletedAt: null, isHistorical: false, category: r.category, paymentMode: r.paymentMode, date, partyGroup: "Candidate" },
      { activeBanks, startsOn: settings.startsOn },
    );
    return {
      id: r.id,
      date,
      amount: Number(r.amount),
      paymentMode: r.paymentMode,
      subItem: r.subItem,
      party: r.party,
      reason:
        why === "not_invoice_bank"
          ? "Not invoiced (payment mode)"
          : why === "bank_off"
            ? "Invoicing off for this bank"
            : why === "before_cutover" || why === "no_cutover"
              ? "Before in-app invoicing"
              : "Waiting to be invoiced",
    };
  });
}

// ── the lead's Transactions tab ──────────────────────────────────────────────

const round = (n: number) => round2(n);

/** The lead's Transactions tab: its candidate's money, if the viewer may see it. */
export async function leadTransactions(userId: string, perms: Permissions, leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { partyId: true } });
  if (!lead) throw notFound();
  return partyTransactions(userId, perms, lead.partyId);
}

/**
 * Everything the Transactions view shows for one candidate: their services
 * and package, the instalment plan, approved payments with their invoices,
 * and payments still waiting for Finance. `via` is null (and nothing else is
 * returned) when there is no candidate yet or the viewer may not see it.
 */
export async function partyTransactions(userId: string, perms: Permissions, partyId: string | null) {
  if (!partyId) return { via: null as null, partyId: null, empty: true as const };
  const via = await partyViewerAccess(userId, perms, partyId);
  if (!via) return { via: null as null, partyId, empty: true as const };
  const [services, payments, pending, plans, startsOn] = await Promise.all([
    prisma.partyService.findMany({
      where: { partyId },
      select: { id: true, totalAmount: true, service: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.transaction.findMany({
      where: { partyId, type: "Revenue", deletedAt: null },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        date: true,
        amount: true,
        paymentMode: true,
        category: true,
        subItem: true,
        description: true,
        isHistorical: true,
        invoices: {
          select: { id: true, number: true, status: true, invoiceDate: true },
          orderBy: { issuedAt: "asc" },
        },
      },
    }),
    prisma.pendingApproval.findMany({
      where: { status: "pending", kind: "create", proposed: { path: ["partyId"], equals: partyId } },
      select: { id: true, proposed: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.collectionPlan.findMany({
      where: { partyId, status: { not: "cancelled" } },
      select: {
        id: true,
        label: true,
        status: true,
        installments: {
          select: { id: true, seq: true, expectedDate: true, amount: true, status: true },
          orderBy: { seq: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    getStartsOn(),
  ]);
  const today = todayIst();
  const packageTotal = round(services.reduce((s, x) => s + Number(x.totalAmount), 0));
  const paid = round(payments.reduce((s, p) => s + Number(p.amount), 0));
  const finance = via === "finance";
  return {
    via,
    partyId,
    empty: false as const,
    /** In-app invoicing start: earlier bank payments were invoiced outside DesGro. */
    invoicingStartsOn: startsOn,
    services: services.map((s) => ({ id: s.id, name: s.service.name, total: Number(s.totalAmount) })),
    totals: { package: packageTotal, paid, balance: round(Math.max(0, packageTotal - paid)) },
    payments: payments.map((p) => ({
      id: p.id,
      date: fromPrismaDate(p.date),
      amount: Number(p.amount),
      paymentMode: p.paymentMode,
      kind: /^Collection/.test(p.category) ? "Collection" : /^Sales/.test(p.category) ? "Sales" : p.category,
      subItem: p.subItem,
      // Free text can carry bank references (UTR, payer account): Finance only.
      description: finance ? p.description : null,
      isHistorical: p.isHistorical,
      invoices: p.invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, invoiceDate: fromPrismaDate(i.invoiceDate) })),
    })),
    pending: pending
      .map((p) => p.proposed as { type?: string; date?: string; amount?: number; paymentMode?: string } | null)
      .map((d, i) => ({ id: pending[i].id, ...d }))
      .filter((d) => d.type === "Revenue")
      .map((d) => ({
        id: d.id,
        date: String(d.date ?? "").slice(0, 10),
        amount: Number(d.amount ?? 0),
        paymentMode: d.paymentMode ?? "",
      })),
    schedule: plans.flatMap((plan) =>
      plan.installments.map((i) => {
        const due = fromPrismaDate(i.expectedDate);
        const state =
          i.status === "received"
            ? "paid"
            : i.status === "submitted"
              ? "submitted"
              : i.status === "cancelled"
                ? "cancelled"
                : due < today
                  ? "overdue"
                  : "due";
        return { id: i.id, plan: plan.label, seq: i.seq, due, amount: Number(i.amount), state };
      }),
    ),
  };
}
export type PartyTransactions = Awaited<ReturnType<typeof partyTransactions>>;
