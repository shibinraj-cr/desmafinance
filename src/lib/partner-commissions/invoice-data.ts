import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/http-error";
import { STAMP_FONT_PUBLIC_PATH } from "@/lib/esign/font";
import { amountInWords, invoiceTotal } from "./logic";
import { getSettings } from "./server";
import { loadAccount } from "./accounts";
import type { InvoicePdfData } from "./pdf";

/**
 * Everything the invoice PDF prints, read fresh from the database. The logo and
 * the Unicode fallback font come from public/ on disk, traced into the PDF
 * route's bundle by next.config.mjs.
 */

let logo: Promise<Uint8Array | null> | null = null;
const loadLogo = () =>
  (logo ??= readFile(path.join(process.cwd(), "public", "desma-logo.png"))
    .then((b) => new Uint8Array(b))
    .catch(() => null));

let font: Promise<Uint8Array | null> | null = null;
const loadFont = () =>
  (font ??= readFile(path.join(process.cwd(), "public", STAMP_FONT_PUBLIC_PATH))
    .then((b) => new Uint8Array(b))
    .catch(() => null));

export async function loadInvoicePdfData(id: string): Promise<InvoicePdfData> {
  const [inv, s, logoPng, fallbackFont] = await Promise.all([
    prisma.commissionInvoice.findUnique({
      where: { id },
      include: { lines: { orderBy: { position: "asc" } }, partner: { select: { layout: true } } },
    }),
    getSettings(),
    loadLogo(),
    loadFont(),
  ]);
  if (!inv) throw notFound("That invoice no longer exists.");
  // Paid into an Indian bank: DESMA International Pvt Ltd's export invoice, with
  // the Finance › Invoices letterhead, that bank's details and the LUT line.
  const account = await loadAccount(prisma, inv.paymentMode);
  const india = !account.ownSettings;
  const lines = inv.lines.map((l) => ({
    description: l.description,
    studentId: l.studentId,
    courseName: l.courseName,
    intakeMonth: l.intakeMonth,
    courseFee: Number(l.courseFee),
    commissionPct: Number(l.commissionPct),
    commissionFlat: l.commissionFlat == null ? null : Number(l.commissionFlat),
    amount: Number(l.amount),
  }));
  const total = invoiceTotal(lines);
  return {
    number: inv.number,
    invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
    paymentTerm: inv.paymentTerm,
    currency: inv.currency,
    billTo: { name: inv.billToName, address: inv.billToAddress, email: inv.billToEmail, forLine: inv.billToFor },
    layout: inv.partner.layout,
    lines,
    total,
    words: inv.amountWords ?? amountInWords(total, inv.currency),
    issuer: india
      ? { name: account.issuerName, address: account.issuerLines, regLine: "" }
      : { name: s.issuerName, address: s.issuerAddress, regLine: s.issuerRegLine },
    bank: india
      ? { accountName: "", currency: "", iban: "", bic: "", accountNo: "" }
      : { accountName: s.bankAccountName, currency: s.bankCurrency, iban: s.bankIban, bic: s.bankBic, accountNo: s.bankAccountNo },
    bankLines: india ? account.bankLines : null,
    title: india ? "Export Invoice" : null,
    signFor: india ? account.signFor : null,
    thanksLine: india ? account.thanksLine || null : null,
    note: india ? account.lutLine : null,
    signatory: india
      ? { name: account.signatoryName, image: account.signature }
      : {
          name: s.signatoryName,
          image: s.signaturePng && s.signatureMime ? { bytes: new Uint8Array(s.signaturePng), mime: s.signatureMime } : null,
        },
    logoPng,
    fallbackFont,
    cancelled: inv.status === "cancelled",
  };
}

/** "D/DLLC/26-27/012" → "D-DLLC-26-27-012.pdf" */
export function invoiceFileName(number: string): string {
  return `${number.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "invoice"}.pdf`;
}
