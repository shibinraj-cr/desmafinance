import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api";
import { HttpError } from "@/lib/http-error";
import { FinancePatchSchema } from "@/lib/crm-enroll-confirm";
import { approveEnrollment, requireEnrollmentAccess } from "@/lib/crm-enrollment";
import { getInvoiceAccess, issueInvoice } from "@/lib/invoices/server";

export const dynamic = "force-dynamic";

const Body = z.object({
  patch: FinancePatchSchema.nullable().optional(),
  // The version Finance opened: refused if the enrollment changed since.
  expectedUpdatedAt: z.string().nullable().optional(),
  // Issue the GST invoice straight after posting (Axis, HDFC, Wio).
  invoice: z
    .object({
      kind: z.enum(["DOM", "EXP"]),
      invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      description: z.string().max(200),
      foreign: z.object({ currency: z.string().max(3), amount: z.coerce.number() }).nullable().optional(),
    })
    .nullable()
    .optional(),
});

// POST — Finance approves: the first payment is posted to the ledger, the
// balance plan becomes the collection plan, and the invoice can be issued in
// the same step. An invoice that can't be issued (settings unfinished, no
// address) doesn't undo the approval: the payment waits in Invoices › To invoice.
export const POST = withApiHandler(async (req: Request, { params }: { params: { id: string } }) => {
  const a = await requireEnrollmentAccess("approve");
  const d = Body.parse(await req.json().catch(() => null));
  const approved = await approveEnrollment(a, params.id, d.patch ?? null, d.expectedUpdatedAt);

  let invoice: { id: string; number: string } | null = null;
  let invoiceError: string | null = null;
  if (d.invoice) {
    const ia = await getInvoiceAccess();
    if (!ia?.isFinance) {
      invoiceError = "You don't have access to Invoices, so it wasn't issued.";
    } else {
      const f = approved.fields;
      try {
        invoice = await issueInvoice(ia, {
          transactionId: approved.transactionId,
          kind: d.invoice.kind,
          invoiceDate: d.invoice.invoiceDate,
          description: d.invoice.description,
          intakeMonth: null,
          billTo: {
            name: f.billingName,
            address: f.billingAddress ?? "",
            pin: f.billingPin ?? "",
            state: f.billingState,
            country: f.billingCountry,
          },
          saveToParty: true,
          foreign: d.invoice.foreign && d.invoice.foreign.amount > 0 ? { currency: d.invoice.foreign.currency, amount: d.invoice.foreign.amount } : null,
        });
      } catch (e) {
        invoiceError = e instanceof HttpError ? e.message : "The invoice couldn't be issued.";
        if (!(e instanceof HttpError)) console.error("[enrollments] invoice after approve failed", e);
      }
    }
  }
  return NextResponse.json({ ok: true, transactionId: approved.transactionId, invoice, invoiceError });
});
