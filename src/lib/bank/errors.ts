/**
 * Failure vocabulary for the bank-statement pipeline, and the retry policy each
 * failure carries. Every step throws a BankAutomationError so the engine can
 * decide — from the code alone — whether to back off and retry, stop for a
 * person, or give up.
 */

export type BankErrorCode =
  /** DNS, reset, 5xx — transient. */
  | "NETWORK"
  /** The SmartStatement page or a download did not finish in time. */
  | "BROWSER_TIMEOUT"
  /** The bank refused the statement password. Retrying would only lock the account. */
  | "PASSWORD_REJECTED"
  /** CAPTCHA / OTP / MFA / bot check. Never bypassed — a person must step in. */
  | "CAPTCHA_OR_MFA"
  /** The statement link is expired or already used. */
  | "LINK_EXPIRED"
  /** The page no longer looks like the flow the downloader knows. */
  | "PAGE_CHANGED"
  /** What came back is not a usable PDF. */
  | "PDF_INVALID"
  /** The PDF is encrypted and the configured password does not open it. */
  | "PDF_PASSWORD"
  /** Text extraction or the bank parser could not read the statement. */
  | "PARSE_FAILED"
  /** Gmail refused the stored credential (revoked / expired). */
  | "GMAIL_AUTH"
  | "GMAIL_ERROR"
  | "STORAGE"
  /** Something the administrator has to configure (password, browser, mailbox). */
  | "CONFIG";

export class BankAutomationError extends Error {
  constructor(
    readonly code: BankErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BankAutomationError";
  }
}

export type RetryDecision =
  | { kind: "retry"; delayMs: number }
  /** Stop and ask a person (MANUAL_ACTION_REQUIRED). */
  | { kind: "manual" }
  /** Stop as FAILED; a person can retry from the Statements tab. */
  | { kind: "fail" };

/**
 * Total attempts allowed per code, counting the first. Network errors get three
 * tries and browser timeouts one first try plus two retries, as specified; a
 * parse failure is not retried here because the parser already falls back to
 * its second strategy inside the same attempt.
 */
const MAX_ATTEMPTS: Partial<Record<BankErrorCode, number>> = {
  NETWORK: 3,
  GMAIL_ERROR: 3,
  STORAGE: 3,
  BROWSER_TIMEOUT: 3,
};

const MANUAL: ReadonlySet<BankErrorCode> = new Set<BankErrorCode>([
  "PASSWORD_REJECTED",
  "CAPTCHA_OR_MFA",
  "PDF_PASSWORD",
  "LINK_EXPIRED",
  "GMAIL_AUTH",
  "CONFIG",
]);

/** Five minutes, doubling: 5, 10, 20 … capped at an hour. */
export function backoffMs(attempt: number): number {
  return Math.min(60, 5 * 2 ** Math.max(0, attempt - 1)) * 60_000;
}

/** `attempts` is how many attempts have now been made, including the failed one. */
export function retryDecision(code: BankErrorCode, attempts: number): RetryDecision {
  if (MANUAL.has(code)) return { kind: "manual" };
  const max = MAX_ATTEMPTS[code];
  if (max && attempts < max) return { kind: "retry", delayMs: backoffMs(attempts) };
  return { kind: "fail" };
}

/** Wrap anything thrown into a BankAutomationError, classifying the common cases. */
export function toBankError(e: unknown): BankAutomationError {
  if (e instanceof BankAutomationError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout|timed out/i.test(msg)) return new BankAutomationError("BROWSER_TIMEOUT", msg);
  if (/ECONNRESET|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|socket hang up|net::ERR_/i.test(msg)) {
    return new BankAutomationError("NETWORK", msg);
  }
  return new BankAutomationError("PARSE_FAILED", msg);
}

/** Plain-English reason shown in alerts and the Statements tab. */
export const ERROR_LABEL: Record<BankErrorCode, string> = {
  NETWORK: "Network error reaching the bank or Google",
  BROWSER_TIMEOUT: "The statement page did not load in time",
  PASSWORD_REJECTED: "The bank rejected the statement password",
  CAPTCHA_OR_MFA: "The bank asked for CAPTCHA / OTP verification",
  LINK_EXPIRED: "The statement link has expired",
  PAGE_CHANGED: "The bank's statement page layout has changed",
  PDF_INVALID: "The downloaded file is not a valid PDF",
  PDF_PASSWORD: "The PDF could not be opened with the statement password",
  PARSE_FAILED: "The statement layout could not be parsed",
  GMAIL_AUTH: "Gmail is disconnected — reconnect the mailbox",
  GMAIL_ERROR: "Gmail returned an error",
  STORAGE: "The statement PDF could not be archived",
  CONFIG: "The integration is not fully configured",
};
