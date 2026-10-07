import { describe, it, expect } from "vitest";
import { HDFCStatementParser, parseByColumns, parseByText } from "@/lib/bank/parsers/hdfc";
import { groupLines } from "@/lib/bank/parsers/base";
import { validateStatement } from "@/lib/bank/validate";
import { classifyNarration } from "@/lib/bank/classify";
import { transactionHash } from "@/lib/bank/hash";
import { BankAutomationError } from "@/lib/bank/errors";
import { autoSummary, generateRows, hdfcFixture, type FixtureRow } from "./fixtures/hdfc-statement";

const parser = new HDFCStatementParser();
const expectOk = { last4: "1234", periodStart: "2026-10-06", periodEnd: "2026-10-06", today: "2026-10-07" };

function parseAndValidate(items: ReturnType<typeof hdfcFixture>, expect_ = expectOk) {
  const p = parser.parse(items);
  return { p, v: validateStatement(p, expect_) };
}

describe("HDFC parser — single rows", () => {
  it("reads a single debit into the debit column", () => {
    const { p, v } = parseAndValidate(
      hdfcFixture({ rows: [{ date: "06/10/26", narration: ["ATW-123456XXXXXX7890-S1AW0001-KOCHI"], debit: "5,000.00", balance: "95,000.00" }] }),
    );
    expect(v.errors).toEqual([]);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ txnDate: "2026-10-06", debit: 500000, credit: 0, balance: 9500000 });
    expect(p.openingBalance).toBe(10000000);
    expect(p.closingBalance).toBe(9500000);
  });

  it("reads a single credit into the credit column (not reversed)", () => {
    const { p, v } = parseAndValidate(
      hdfcFixture({ rows: [{ date: "06/10/26", narration: ["NEFT CR-ABCD0001234-ACME LTD-INV42"], ref: "ABCDN26279000001", credit: "1,23,456.78", balance: "2,23,456.78" }] }),
    );
    expect(v.errors).toEqual([]);
    expect(p.rows[0].credit).toBe(12345678);
    expect(p.rows[0].debit).toBe(0);
    expect(p.rows[0].referenceNumber).toBe("ABCDN26279000001");
  });

  it("keeps multiline narrations together on one transaction", () => {
    const { p, v } = parseAndValidate(
      hdfcFixture({
        rows: [
          { date: "06/10/26", narration: ["UPI-SOME LONG MERCHANT NAME-", "merchant.name@okbank-ABCD0000123-", "612345678901-ORDER 77"], ref: "0000612345678901", debit: "799.00", balance: "99,201.00" },
          { date: "06/10/26", narration: ["IMPS-612345678902-JANE DOE-", "BANK-XXXXXXXX1111-FEES"], ref: "0000612345678902", credit: "2,000.00", balance: "1,01,201.00" },
        ],
      }),
    );
    expect(v.errors).toEqual([]);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0].description).toBe("UPI-SOME LONG MERCHANT NAME- merchant.name@okbank-ABCD0000123- 612345678901-ORDER 77");
    expect(p.rows[1].description).toContain("JANE DOE");
    expect(p.rows[0].rawText.split("\n")).toHaveLength(3);
  });

  it("handles a missing reference", () => {
    const { p, v } = parseAndValidate(
      hdfcFixture({ rows: [{ date: "06/10/26", narration: ["SMS ALERT CHARGES"], debit: "17.70", balance: "99,982.30" }] }),
    );
    expect(v.errors).toEqual([]);
    expect(p.rows[0].referenceNumber).toBeNull();
    expect(classifyNarration(p.rows[0].description)).toBe("BANK_CHARGES");
  });
});

describe("HDFC parser — statement shapes", () => {
  it("accepts a statement with no transactions", () => {
    const { p, v } = parseAndValidate(
      hdfcFixture({ rows: [], summary: { opening: "50,000.00", drCount: 0, crCount: 0, debits: "0.00", credits: "0.00", closing: "50,000.00" } }),
    );
    expect(p.rows).toEqual([]);
    expect(v.errors).toEqual([]);
  });

  it("parses all 20 transactions of a 20-row statement with directions and balances right", () => {
    const rows = generateRows(20);
    const { p, v } = parseAndValidate(hdfcFixture({ rows }));
    expect(v.errors).toEqual([]);
    expect(p.rows).toHaveLength(20);
    p.rows.forEach((r, i) => {
      expect(r.debit > 0).toBe(!!rows[i].debit);
      expect(r.credit > 0).toBe(!!rows[i].credit);
      expect(r.balance).toBe(Math.round(Number(rows[i].balance.replace(/,/g, "")) * 100));
    });
  });

  it("parses a large multi-page statement (300 rows, repeated headers)", () => {
    const rows = generateRows(300);
    const { p, v } = parseAndValidate(hdfcFixture({ rows, rowsPerPage: 35 }));
    expect(p.rows).toHaveLength(300);
    expect(v.errors).toEqual([]);
  });

  it("spans a month boundary", () => {
    const rows: FixtureRow[] = [
      { date: "30/09/26", narration: ["NEFT DR-ABCD0009999-LANDLORD-RENT"], debit: "40,000.00", balance: "60,000.00" },
      { date: "01/10/26", narration: ["RTGS CR-ABCD0004321-BIG CLIENT-INV9"], credit: "5,00,000.00", balance: "5,60,000.00" },
    ];
    const items = hdfcFixture({ rows, from: "30/09/2026", to: "01/10/2026" });
    const { p, v } = parseAndValidate(items, { ...expectOk, periodStart: "2026-09-30", periodEnd: "2026-10-01" });
    expect(v.errors).toEqual([]);
    expect(p.rows.map((r) => r.txnDate)).toEqual(["2026-09-30", "2026-10-01"]);
    expect(classifyNarration(p.rows[1].description)).toBe("RTGS");
  });

  it("keeps multiple transactions of the same amount as distinct rows with distinct hashes", () => {
    const rows: FixtureRow[] = [1, 2, 3].map((i) => ({
      date: "06/10/26",
      narration: ["UPI-TEA STALL-tea@okbank-ABCD0000123-6000000000" + i + "0-UPI"],
      debit: "20.00",
      balance: (100000 - 20 * i).toLocaleString("en-IN", { minimumFractionDigits: 2 }),
    }));
    const { p, v } = parseAndValidate(hdfcFixture({ rows }));
    expect(v.errors).toEqual([]);
    const hashes = p.rows.map((r) => transactionHash({ integrationId: "i1", ...r }));
    expect(new Set(hashes).size).toBe(3);
  });

  it("separates same-day look-alikes that differ only by reference", () => {
    const rows: FixtureRow[] = [
      { date: "06/10/26", narration: ["IMPS-REFUND"], ref: "000011112222", credit: "500.00", balance: "1,00,500.00" },
      { date: "06/10/26", narration: ["IMPS-REFUND"], ref: "000011113333", credit: "500.00", balance: "1,01,000.00" },
    ];
    const { p } = parseAndValidate(hdfcFixture({ rows }));
    expect(p.rows.map((r) => r.referenceNumber)).toEqual(["000011112222", "000011113333"]);
    const [a, b] = p.rows.map((r) => transactionHash({ integrationId: "i1", ...r }));
    expect(a).not.toBe(b);
  });
});

describe("HDFC parser — safety", () => {
  it("corrects and FLAGS a row whose amount sits under the wrong column (balance disagrees)", () => {
    // The bank's balance fell by 1,000 but the amount was printed under Deposit.
    const rows: FixtureRow[] = [{ date: "06/10/26", narration: ["CHQ PAID-MICR CTS-ACME"], credit: "1,000.00", balance: "99,000.00" }];
    const items = hdfcFixture({
      rows,
      summary: { opening: "1,00,000.00", drCount: 1, crCount: 0, debits: "1,000.00", credits: "0.00", closing: "99,000.00" },
    });
    // The column read notices the contradiction and flags it…
    const cols = parseByColumns(groupLines(items));
    expect(cols.anomalies.join(" ")).toMatch(/direction corrected/);
    // …and the final answer is the debit the bank's own balance (and summary) shows.
    const { p, v } = parseAndValidate(items);
    expect(p.rows[0].debit).toBe(100000);
    expect(p.rows[0].credit).toBe(0);
    expect(v.errors).toEqual([]);
  });

  it("holds a contradictory row for review when the summary does not corroborate the balance", () => {
    // Amount under Deposit, balance fell, and the summary claims it was a credit:
    // no reading is consistent, so nothing may be imported without a person.
    const rows: FixtureRow[] = [{ date: "06/10/26", narration: ["CHQ PAID-MICR CTS-ACME"], credit: "1,000.00", balance: "99,000.00" }];
    const items = hdfcFixture({
      rows,
      summary: { opening: "1,00,000.00", drCount: 0, crCount: 1, debits: "0.00", credits: "1,000.00", closing: "99,000.00" },
    });
    const { v } = parseAndValidate(items);
    expect(v.errors.length).toBeGreaterThan(0);
  });

  it("sends a broken running balance to review", () => {
    const rows: FixtureRow[] = [
      { date: "06/10/26", narration: ["UPI-A"], debit: "100.00", balance: "99,900.00" },
      { date: "06/10/26", narration: ["UPI-B"], debit: "100.00", balance: "99,700.00" }, // should be 99,800
    ];
    const { v } = parseAndValidate(hdfcFixture({ rows }));
    expect(v.errors.join(" ")).toMatch(/Running balance does not chain|closing balance/);
  });

  it("flags a summary that disagrees with the rows read", () => {
    const rows = generateRows(5);
    const s = autoSummary(rows);
    const { v } = parseAndValidate(hdfcFixture({ rows, summary: { ...s, drCount: s.drCount + 1 } }));
    expect(v.errors.join(" ")).toMatch(/Summary shows/);
  });

  it("rejects a statement for a different account", () => {
    const { v } = parseAndValidate(hdfcFixture({ account: "50100000009999", rows: generateRows(2) }));
    expect(v.errors.join(" ")).toMatch(/expected 1234/);
  });

  it("rejects a statement whose period differs from the e-mail", () => {
    const { v } = parseAndValidate(hdfcFixture({ rows: generateRows(2) }), { ...expectOk, periodStart: "2026-10-05", periodEnd: "2026-10-05" });
    expect(v.errors.join(" ")).toMatch(/differs from the e-mail/);
  });

  it("throws PARSE_FAILED on an unrecognised layout instead of importing garbage", () => {
    const items = [
      { str: "Some other bank", x: 10, y: 10, w: 60, page: 1 },
      { str: "06/10/26 thing 1,000.00", x: 10, y: 30, w: 100, page: 1 },
    ];
    expect(() => parser.parse(items)).toThrow(BankAutomationError);
  });

  it("throws PARSE_FAILED on an image-only PDF (no text)", () => {
    expect(() => parser.parse([])).toThrow(/image-only/);
  });
});

describe("HDFC parser — fallback strategy", () => {
  it("recovers from a fused header that misplaces the columns, via the text strategy", () => {
    const rows = generateRows(6);
    const items = hdfcFixture({ rows, mergedHeader: true });
    // The column read is visibly wrong — and says so — rather than silently wrong…
    expect(parseByColumns(groupLines(items)).anomalies.length).toBeGreaterThan(0);
    // …so the parser prefers the clean fallback read.
    const p = parser.parse(items);
    expect(p.strategy).toBe("text");
    expect(validateStatement(p, expectOk).errors).toEqual([]);
    p.rows.forEach((r, i) => expect(r.credit > 0).toBe(!!rows[i].credit));
  });

  it("falls back to the text strategy when the header carries no usable geometry", () => {
    const rows = generateRows(6);
    const items = hdfcFixture({ rows, mergedHeader: true, headerWithoutGeometry: true });
    expect(() => parseByColumns(groupLines(items))).toThrow();
    const p = parser.parse(items);
    expect(p.strategy).toBe("text");
    expect(p.rows).toHaveLength(6);
    const v = validateStatement(p, expectOk);
    expect(v.errors).toEqual([]);
    p.rows.forEach((r, i) => expect(r.debit > 0).toBe(!!rows[i].debit));
  });

  it("text strategy agrees with the column strategy on a normal statement", () => {
    const items = hdfcFixture({ rows: generateRows(12) });
    const a = parseByColumns(groupLines(items));
    const b = parseByText(groupLines(items));
    expect(b.rows.map((r) => [r.txnDate, r.debit, r.credit, r.balance])).toEqual(
      a.rows.map((r) => [r.txnDate, r.debit, r.credit, r.balance]),
    );
  });
});
