-- Record payment keeps the plan's before/after so a payment can be undone. Additive only.
ALTER TABLE "CollectionPlanInstallment" ADD COLUMN "paymentUndo" JSONB;
