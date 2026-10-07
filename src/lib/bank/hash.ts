import { createHash } from "node:crypto";
import { normalizeNarration } from "./classify";
import { toDecimalString, type Paise } from "./money";

/**
 * The deterministic identity of one bank transaction — the third duplicate
 * guard, backed by @@unique([integrationId, transactionHash]).
 *
 * The running balance is part of it on purpose: two genuinely separate
 * same-day payments of the same amount to the same payee still leave
 * different balances behind, so they stay two rows, while the same line read
 * again from a re-sent or overlapping statement hashes identically and is
 * skipped.
 */
export function transactionHash(t: {
  integrationId: string;
  txnDate: string;
  valueDate: string | null;
  description: string;
  referenceNumber: string | null;
  debit: Paise;
  credit: Paise;
  balance: Paise | null;
}): string {
  const parts = [
    t.integrationId,
    t.txnDate,
    t.valueDate ?? "",
    normalizeNarration(t.description),
    (t.referenceNumber ?? "").trim().toUpperCase(),
    toDecimalString(t.debit),
    toDecimalString(t.credit),
    t.balance === null ? "" : toDecimalString(t.balance),
  ];
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

export function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}
