import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { bankTransaction: { createMany: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import {
  extractStatementUrl,
  gmailQuery,
  matchesIntegration,
  parseSubjectPeriod,
  findPdfAttachment,
  collectBodies,
} from "@/lib/bank/email-parse";
import { classifyNarration, extractCounterparty } from "@/lib/bank/classify";
import { isAmountToken, parseAmount, toDecimalString } from "@/lib/bank/money";
import { retryDecision, toBankError } from "@/lib/bank/errors";
import { isBankBusinessDay, isScheduledRunDue, missedBusinessDays, zonedParts } from "@/lib/bank/schedule";
import { envSecretName, redact, seal, unseal } from "@/lib/bank/secrets";
import { importRows } from "@/lib/bank/import";
import { HDFCStatementParser } from "@/lib/bank/parsers/hdfc";
import { generateRows, hdfcFixture } from "./fixtures/hdfc-statement";

const SUBJECT = "Email Account Statement of your HDFC Bank Account ***1234 for the period 06-Oct-2026 TO 06-Oct-2026";
const RULE = {
  sender: "hdfcbanksmartstatement@hdfcbank.bank.in",
  subjectPattern: "Email Account Statement of your HDFC Bank Account ***{last4} for the period",
  last4: "1234",
};

describe("statement e-mail matching", () => {
  it("matches sender exactly and the subject by containment, whatever the date", () => {
    expect(matchesIntegration({ from: `"HDFC Bank" <${RULE.sender}>`, subject: SUBJECT }, RULE)).toBe(true);
    expect(
      matchesIntegration({ from: RULE.sender, subject: SUBJECT.replace("06-Oct-2026 TO 06-Oct-2026", "31-Dec-2026 TO 31-Dec-2026") }, RULE),
    ).toBe(true);
  });

  it("rejects another account, another sender, or a look-alike domain", () => {
    expect(matchesIntegration({ from: RULE.sender, subject: SUBJECT.replace("1234", "9999") }, RULE)).toBe(false);
    expect(matchesIntegration({ from: "alerts@hdfcbank.net", subject: SUBJECT }, RULE)).toBe(false);
    expect(matchesIntegration({ from: "hdfcbanksmartstatement@hdfcbank.bank.in.evil.com", subject: SUBJECT }, RULE)).toBe(false);
  });

  it("parses the statement period out of the subject", () => {
    expect(parseSubjectPeriod(SUBJECT)).toEqual({ start: "2026-10-06", end: "2026-10-06" });
    expect(parseSubjectPeriod("… for the period 30-Sep-2026 TO 01-Oct-2026")).toEqual({ start: "2026-09-30", end: "2026-10-01" });
    expect(parseSubjectPeriod("… for the period 31-Feb-2026 TO 01-Mar-2026")).toBeNull();
    expect(parseSubjectPeriod("no period here")).toBeNull();
  });

  it("extracts the SmartStatement link only from the bank's own host", () => {
    const html = `<a href="https://evil.example/GetStatement.jsp?jobkey=x">x</a>
      <a href="https://smartstatements.hdfc.bank.in/HDFCRestFulService/GetStatement.jsp?jobkey=ABC&amp;x=1">View</a>`;
    expect(extractStatementUrl([html], "HDFC")).toBe(
      "https://smartstatements.hdfc.bank.in/HDFCRestFulService/GetStatement.jsp?jobkey=ABC&x=1",
    );
    expect(extractStatementUrl(['<a href="https://smartstatements.hdfc.bank.in.evil.io/x">'], "HDFC")).toBeNull();
    expect(extractStatementUrl(["http://smartstatements.hdfc.bank.in/x"], "HDFC")).toBeNull();
  });

  it("finds a PDF attachment and decodes bodies from a Gmail payload", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/html", body: { data: Buffer.from("<p>hi</p>").toString("base64url") } },
        { mimeType: "application/pdf", filename: "stmt.pdf", body: { attachmentId: "att-1" } },
      ],
    };
    expect(collectBodies(payload)).toEqual(["<p>hi</p>"]);
    expect(findPdfAttachment(payload)).toEqual({ attachmentId: "att-1", filename: "stmt.pdf" });
  });

  it("builds a loose Gmail query (strict matching happens locally)", () => {
    const q = gmailQuery({ sender: RULE.sender, subject: "Account ***1234 for the period", afterIso: "2026-10-01", beforeIso: "2026-10-08" });
    expect(q).toBe(`from:${RULE.sender} subject:(Account 1234 for the period) after:2026/10/01 before:2026/10/08`);
  });
});

describe("classification", () => {
  it.each([
    ["UPI-JOHN DOE-john@okbank-ABCD0000123-612345678901-RENT", "UPI"],
    ["UPI-SCHOOL-school@okbank-ABCD0000123-612345678901-FEE CHARGES", "UPI"],
    ["IMPS-612345678901-JANE-HDFC-XXXX1111-REFUND", "IMPS"],
    ["NEFT CR-ABCD0001234-ACME LTD-INV42", "NEFT"],
    ["RTGS DR-ABCD0001234-BIG VENDOR-PO7", "RTGS"],
    ["ACH D- TP ACH INSURANCE-123456", "ACH"],
    ["NACH-DR-LOAN EMI", "NACH"],
    ["CHQ PAID-MICR CTS-ACME", "CHEQUE"],
    ["POS 123456XXXXXX7890 SUPERMART", "CARD"],
    ["ATW-123456XXXXXX7890-S1AW0001-KOCHI", "ATM"],
    ["SMS ALERT CHARGES", "BANK_CHARGES"],
    ["IMPS CHGS-GST", "BANK_CHARGES"],
    ["CREDIT INTEREST CAPITALISED", "INTEREST"],
    ["CASH DEPOSIT BY SELF", "CASH"],
    ["FT - CR - 50100000001234 - OWN ACCOUNT", "TRANSFER"],
    ["SOMETHING ELSE ENTIRELY", "OTHER"],
  ])("%s → %s", (narration, type) => {
    expect(classifyNarration(narration)).toBe(type);
  });

  it("pulls the UPI counterparty and reference without altering the narration", () => {
    const n = "UPI-JOHN DOE-john@okbank-ABCD0000123-612345678901-RENT";
    expect(extractCounterparty(n, "UPI")).toEqual({ counterpartyName: "JOHN DOE", upiReference: "612345678901", bankReference: null });
  });
});

describe("money", () => {
  it("parses Indian-grouped amounts exactly in paise", () => {
    expect(parseAmount("1,23,456.78")).toBe(12345678);
    expect(parseAmount("0.10")).toBe(10);
    expect(parseAmount("12.00 Dr")).toBe(-1200);
    expect(parseAmount("abc")).toBeNull();
    expect(toDecimalString(12345678)).toBe("123456.78");
    expect(toDecimalString(-5)).toBe("-0.05");
    expect(isAmountToken("1,00,000.00")).toBe(true);
    expect(isAmountToken("612345678901")).toBe(false);
  });
});

describe("retry policy", () => {
  it("retries network errors up to 3 attempts with backoff", () => {
    expect(retryDecision("NETWORK", 1)).toEqual({ kind: "retry", delayMs: 5 * 60_000 });
    expect(retryDecision("NETWORK", 2)).toEqual({ kind: "retry", delayMs: 10 * 60_000 });
    expect(retryDecision("NETWORK", 3)).toEqual({ kind: "fail" });
  });
  it("retries browser timeouts twice", () => {
    expect(retryDecision("BROWSER_TIMEOUT", 2).kind).toBe("retry");
    expect(retryDecision("BROWSER_TIMEOUT", 3).kind).toBe("fail");
  });
  it("never retries a rejected password or a CAPTCHA — a person must act", () => {
    expect(retryDecision("PASSWORD_REJECTED", 1)).toEqual({ kind: "manual" });
    expect(retryDecision("CAPTCHA_OR_MFA", 1)).toEqual({ kind: "manual" });
    expect(retryDecision("PDF_PASSWORD", 1)).toEqual({ kind: "manual" });
  });
  it("does not loop on parse failures or page changes", () => {
    expect(retryDecision("PARSE_FAILED", 1)).toEqual({ kind: "fail" });
    expect(retryDecision("PAGE_CHANGED", 1)).toEqual({ kind: "fail" });
  });
  it("classifies raw errors", () => {
    expect(toBankError(new Error("page.goto: Timeout 45000ms exceeded")).code).toBe("BROWSER_TIMEOUT");
    expect(toBankError(new Error("fetch failed")).code).toBe("NETWORK");
  });
});

describe("schedule", () => {
  const at = (iso: string) => new Date(iso);
  it("is due once a day at or after the configured IST time", () => {
    const base = { enabled: true, runTime: "09:30", timeZone: "Asia/Kolkata" };
    expect(isScheduledRunDue({ ...base, now: at("2026-10-07T03:59:00Z"), lastScheduledRunOn: null })).toBe(false); // 09:29 IST
    expect(isScheduledRunDue({ ...base, now: at("2026-10-07T04:00:00Z"), lastScheduledRunOn: null })).toBe(true); // 09:30 IST
    expect(isScheduledRunDue({ ...base, now: at("2026-10-07T10:00:00Z"), lastScheduledRunOn: "2026-10-07" })).toBe(false);
    expect(isScheduledRunDue({ ...base, enabled: false, now: at("2026-10-07T10:00:00Z"), lastScheduledRunOn: null })).toBe(false);
    expect(zonedParts(at("2026-10-06T20:00:00Z"), "Asia/Kolkata").date).toBe("2026-10-07");
  });

  it("knows bank holidays: Sundays and 2nd/4th Saturdays", () => {
    expect(isBankBusinessDay("2026-10-04")).toBe(false); // Sunday
    expect(isBankBusinessDay("2026-10-03")).toBe(true); // 1st Saturday
    expect(isBankBusinessDay("2026-10-10")).toBe(false); // 2nd Saturday
    expect(isBankBusinessDay("2026-10-24")).toBe(false); // 4th Saturday
    expect(isBankBusinessDay("2026-10-05")).toBe(true); // Monday
  });

  it("does not count a weekend gap as missed statements", () => {
    // Last statement Fri 9 Oct; Sat 10 (2nd Sat) + Sun 11 closed; today Mon 12.
    expect(missedBusinessDays("2026-10-09", "2026-10-12")).toBe(0);
    // …but by Thu 15, Mon–Wed are three missed business days.
    expect(missedBusinessDays("2026-10-09", "2026-10-15")).toBe(3);
  });
});

describe("secrets", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-bank-automation";
    delete process.env.BANK_SECRETS_KEY;
  });
  it("round-trips sealed values and refuses a different purpose", () => {
    const s = seal("hunter2", "statement-password");
    expect(s).not.toContain("hunter2");
    expect(unseal(s, "statement-password")).toBe("hunter2");
    expect(() => unseal(s, "statement-url")).toThrow();
  });
  it("redacts the password, tokens and statement links from any text", () => {
    const text =
      'fill("hunter2") failed; Authorization: Bearer ya29.abc.def; refresh_token=1//xyz https://smartstatements.hdfc.bank.in/GetStatement.jsp?jobkey=SECRETKEY';
    const out = redact(text, ["hunter2"]);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("ya29.abc");
    expect(out).not.toContain("1//xyz");
    expect(out).not.toContain("SECRETKEY");
  });
  it("only accepts env references of the expected shape", () => {
    expect(envSecretName("env:HDFC_STATEMENT_PASSWORD")).toBe("HDFC_STATEMENT_PASSWORD");
    expect(envSecretName("env:lower")).toBeNull();
    expect(envSecretName("db")).toBeNull();
  });
});

describe("import idempotency", () => {
  // An in-memory stand-in for @@unique([integrationId, transactionHash]) + skipDuplicates.
  const table = new Map<string, unknown>();
  const createMany = prisma.bankTransaction.createMany as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => {
    table.clear();
    createMany.mockImplementation(async ({ data }: { data: Array<{ integrationId: string; transactionHash: string }> }) => {
      let count = 0;
      for (const d of data) {
        const k = `${d.integrationId}|${d.transactionHash}`;
        if (!table.has(k)) {
          table.set(k, d);
          count++;
        }
      }
      return { count };
    });
  });

  const ctx = { integrationId: "int-1", statementId: "st-1", currency: "INR", statementDate: "2026-10-06", gmailMessageId: "m1", sourceSubject: SUBJECT };
  const rows = new HDFCStatementParser().parse(hdfcFixture({ rows: generateRows(20) })).rows;

  it("imports a statement once, then creates zero duplicates on every re-run", async () => {
    expect(await importRows(rows, ctx)).toEqual({ inserted: 20, duplicates: 0 });
    expect(await importRows(rows, ctx)).toEqual({ inserted: 0, duplicates: 20 });
    // A re-sent statement (different message, different statement row) — still zero.
    expect(await importRows(rows, { ...ctx, statementId: "st-2", gmailMessageId: "m2" })).toEqual({ inserted: 0, duplicates: 20 });
    expect(table.size).toBe(20);
  });

  it("an overlapping backfill only adds the rows that are new", async () => {
    await importRows(rows.slice(0, 12), ctx);
    expect(await importRows(rows, ctx)).toEqual({ inserted: 8, duplicates: 12 });
  });

  it("stores amounts as exact decimal strings and keeps the raw narration", async () => {
    await importRows(rows.slice(0, 1), ctx);
    const [stored] = Array.from(table.values()) as Array<Record<string, unknown>>;
    expect(typeof stored.debitAmount).toBe("string");
    expect(stored.description).toBe(rows[0].description);
    expect(stored.transactionType).toBe("NEFT"); // row 0 of the fixture is a NEFT credit
  });
});
