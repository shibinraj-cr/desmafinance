-- Partner Commissions: print the final payment date on a partner's invoices.
-- Additive only: a per-partner switch (off by default, ticked in Settings) and
-- a nullable date on the invoice line, copied from the enrollment when the line
-- is billed. Existing invoices keep no date, so they print as before.
-- AlterTable
ALTER TABLE "CommissionPartner" ADD COLUMN     "printFinalPayment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CommissionInvoiceLine" ADD COLUMN     "fullyPaidOn" DATE;
