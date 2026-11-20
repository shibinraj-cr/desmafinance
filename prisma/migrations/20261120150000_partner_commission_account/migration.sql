-- Partner Commissions: the account each partner pays into (Wio, Axis, HDFC).
-- Existing partners and invoices are Wio, as before. Additive only.
ALTER TABLE "CommissionPartner" ADD COLUMN "paymentMode" TEXT NOT NULL DEFAULT 'Wio Bank';
ALTER TABLE "CommissionInvoice" ADD COLUMN "paymentMode" TEXT NOT NULL DEFAULT 'Wio Bank';
