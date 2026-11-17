import { z } from "zod";
import { INVOICE_KINDS } from "@/lib/invoices/core";

/** The Issue invoice form, shared by issuing and the preview. */
export const IssueBody = z.object({
  transactionId: z.string().min(1).max(60),
  kind: z.enum(INVOICE_KINDS),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().max(400),
  intakeMonth: z.string().max(40).nullable().optional(),
  billTo: z.object({
    name: z.string().max(200),
    address: z.string().max(800),
    pin: z.string().max(20).default(""),
    state: z.string().max(80).nullable().optional(),
    country: z.string().max(80).default("India"),
  }),
  saveToParty: z.boolean().default(true),
  foreign: z.object({ currency: z.string().max(3), amount: z.number().finite() }).nullable().optional(),
});
export type IssueBodyT = z.infer<typeof IssueBody>;

export function toIssueInput(b: IssueBodyT) {
  return {
    transactionId: b.transactionId,
    kind: b.kind,
    invoiceDate: b.invoiceDate,
    description: b.description,
    intakeMonth: b.intakeMonth ?? null,
    billTo: { name: b.billTo.name, address: b.billTo.address, pin: b.billTo.pin, state: b.billTo.state ?? null, country: b.billTo.country },
    saveToParty: b.saveToParty,
    foreign: b.foreign ?? null,
  };
}
