-- Candidate payments received before DesGro's ledger began (1 Apr 2026).
-- Additive with a default, so the running deployment is unaffected while
-- this applies. Existing rows stay live (false): nothing already counted in
-- a report changes.
ALTER TABLE "Transaction" ADD COLUMN "isHistorical" BOOLEAN NOT NULL DEFAULT false;
