-- A sent Partner Commissions invoice gets a collection plan that follows it.
ALTER TABLE "CollectionPlan" ADD COLUMN "commissionInvoiceId" TEXT;

CREATE UNIQUE INDEX "CollectionPlan_commissionInvoiceId_key" ON "CollectionPlan"("commissionInvoiceId");

ALTER TABLE "CollectionPlan" ADD CONSTRAINT "CollectionPlan_commissionInvoiceId_fkey" FOREIGN KEY ("commissionInvoiceId") REFERENCES "CommissionInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
