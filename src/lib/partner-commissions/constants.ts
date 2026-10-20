/**
 * Partner Commissions — NCLEX / OSCE / GCAN enrollments with partner
 * institutions, the monthly commission invoice, and the commission's arrival in
 * Wio. Shared constants; no server-only imports so client components can use
 * them too.
 */

/** Finance's full page: enrollments, invoices, payments, settings. */
export const PC_FINANCE_PAGE = "/finance/partner-commissions";

/**
 * The narrow page for people who may only ADD enrollments (BDEs for GCAN, a
 * named coordinator for OSCE/NCLEX). Not granted through Role.pages: the
 * permissions loader adds it for exactly the people with enrollment access
 * (see enrollAccessPage in permissions.ts), so it shows in their nav and no one
 * else's.
 */
export const PC_ENROLL_PAGE = "/crm/partner-enrollments";

export const PROGRAM_CODES = ["NCLEX", "OSCE", "GCAN"] as const;
export type ProgramCode = (typeof PROGRAM_CODES)[number];

export function isProgramCode(v: unknown): v is ProgramCode {
  return typeof v === "string" && (PROGRAM_CODES as readonly string[]).includes(v);
}

/** Up to three course-fee installments per enrollment. */
export const MAX_INSTALLMENTS = 3;

/** Where an approved commission lands in the ledger. */
export const LEDGER = {
  type: "Revenue",
  category: "Commissions",
  paymentMode: "Wio Bank",
  expDom: "EXP",
  subItem: (code: string) => `${code} Commission`,
} as const;

export const INVOICE_LAYOUTS = ["compact", "detailed"] as const;
export type InvoiceLayout = (typeof INVOICE_LAYOUTS)[number];

export const INVOICE_STATUSES = ["draft", "sent", "awaiting", "partpaid", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const RECEIPT_STATUSES = ["awaiting", "approved", "returned"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

/** Statuses an enrollment is shown in — derived, never stored. */
export type EnrollmentState = "notstarted" | "paying" | "fullypaid" | "invoiced" | "received" | "withdrawn";

export const ENROLLMENT_STATE_LABEL: Record<EnrollmentState, string> = {
  fullypaid: "Fully paid · next run",
  paying: "Paying",
  notstarted: "Awaiting 1st payment",
  invoiced: "Invoiced",
  received: "Commission received",
  withdrawn: "Withdrawn",
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  awaiting: "Payment awaiting approval",
  partpaid: "Part-paid",
  paid: "Paid · posted",
  cancelled: "Cancelled",
};

/** CrmNotification.kind for the alerts this module raises. */
export const PC_NOTIFY_KIND = "partner_commission";
