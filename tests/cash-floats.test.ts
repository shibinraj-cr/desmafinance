/**
 * Cash floats and the director's card (src/lib/cash-floats.ts and the voucher
 * reader): which bank lines are cash withdrawals, a float month by month, the
 * director's claims repaid oldest first, and the Outdoor Marketing voucher
 * sheet. Synthetic data only; money in paise.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { allocateClaims, claimMonths, floatMonths, looksLikeCashWithdrawal, namesPayee } from "@/lib/cash-floats";
import { parseVoucherSheet, voucherHashes } from "@/lib/cash-floats-vouchers";

describe("cash withdrawals", () => {
  it("are ATM / cash debits, by type or narration", () => {
    expect(looksLikeCashWithdrawal({ direction: "DEBIT", transactionType: "ATM", description: "anything" })).toBe(true);
    expect(looksLikeCashWithdrawal({ direction: "DEBIT", transactionType: "OTHER", description: "NWD-1234XXXX-TEST ATM KOCHI" })).toBe(true);
    expect(looksLikeCashWithdrawal({ direction: "DEBIT", transactionType: "OTHER", description: "CASH WDL SELF CHQ 000123" })).toBe(true);
    expect(looksLikeCashWithdrawal({ direction: "CREDIT", transactionType: "ATM", description: "ATM REVERSAL" })).toBe(false);
    expect(looksLikeCashWithdrawal({ direction: "DEBIT", transactionType: "NEFT", description: "NEFT/123/TEST VENDOR" })).toBe(false);
  });

  it("recognises a payment naming the director only on whole words", () => {
    expect(namesPayee("NEFT/AXOIC1234/TEST DIRECTOR/HDFC", ["director"])).toBe(true);
    expect(namesPayee("NEFT/AXOIC1234/TEST DIRECTORS LLP/HDFC", ["director"])).toBe(false);
    expect(namesPayee("NEFT/AXOIC1234/TEST DIRECTOR/HDFC", ["ab"])).toBe(false);
  });
});

describe("a float, month by month", () => {
  it("carries each closing into the next opening, from the starting balance", () => {
    const months = floatMonths(
      { on: "2026-10-01", balance: 500000 },
      [
        { date: "2026-10-05", amount: 2000000 },
        { date: "2026-11-02", amount: 1000000 },
      ],
      [
        { date: "2026-10-20", amount: 1500000 },
        { date: "2026-11-15", amount: 700000 },
      ],
      "2026-11-18",
    );
    expect(months).toEqual([
      { month: "2026-10", opening: 500000, in: 2000000, out: 1500000, closing: 1000000 },
      { month: "2026-11", opening: 1000000, in: 1000000, out: 700000, closing: 1300000 },
    ]);
  });

  it("leaves out what happened before the start (already in the starting balance)", () => {
    const [m] = floatMonths({ on: "2026-11-01", balance: 0 }, [{ date: "2026-10-30", amount: 999 }], [], "2026-11-18");
    expect(m).toEqual({ month: "2026-11", opening: 0, in: 0, out: 0, closing: 0 });
  });

  it("skips months before anything happened with nothing in hand", () => {
    expect(floatMonths({ on: "2026-04-01", balance: 0 }, [{ date: "2026-10-05", amount: 100 }], [], "2026-11-18").map((m) => m.month)).toEqual(["2026-10", "2026-11"]);
    expect(floatMonths({ on: "2026-04-01", balance: 0 }, [], [], "2026-11-18").map((m) => m.month)).toEqual(["2026-11"]);
  });

  it("shows empty months up to today", () => {
    expect(floatMonths({ on: "2026-09-01", balance: 100 }, [], [], "2026-11-18").map((m) => [m.month, m.closing])).toEqual([
      ["2026-09", 100],
      ["2026-10", 100],
      ["2026-11", 100],
    ]);
  });
});

describe("the director's card", () => {
  const claims = [
    { id: "c2", date: "2026-10-12", amount: 300000 },
    { id: "c1", date: "2026-10-03", amount: 500000 },
    { id: "c3", date: "2026-11-01", amount: 200000 },
  ];

  it("repays the oldest claims first, a part payment leaving the rest owed", () => {
    const { claims: out, totals } = allocateClaims(claims, [{ id: "s1", date: "2026-11-05", amount: 600000 }]);
    expect(out.map((c) => [c.id, c.settled, c.outstanding, c.settledOn])).toEqual([
      ["c1", 500000, 0, "2026-11-05"],
      ["c2", 100000, 200000, null],
      ["c3", 0, 200000, null],
    ]);
    expect(totals).toEqual({ claimed: 1000000, repaid: 600000, outstanding: 400000, unapplied: 0 });
  });

  it("keeps anything repaid beyond every claim as an advance, not a negative balance", () => {
    const { totals } = allocateClaims(claims, [
      { id: "s1", date: "2026-11-05", amount: 600000 },
      { id: "s2", date: "2026-11-20", amount: 500000 },
    ]);
    expect(totals).toEqual({ claimed: 1000000, repaid: 1100000, outstanding: 0, unapplied: 100000 });
  });

  it("states claimed, repaid and owed month by month", () => {
    expect(claimMonths(claims, [{ id: "s1", date: "2026-11-05", amount: 600000 }], "2026-11-18")).toEqual([
      { month: "2026-10", claimed: 800000, repaid: 0, outstanding: 800000 },
      { month: "2026-11", claimed: 200000, repaid: 600000, outstanding: 400000 },
    ]);
  });
});

describe("Outdoor Marketing vouchers from Excel", () => {
  const sheet = (rows: unknown[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Vouchers");
    return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  };
  const HEAD = ["Date", "Voucher No", "Paid To", "Purpose", "Amount"];

  it("reads the template's columns, day-first dates and grouped amounts; skips blanks and a Total row", () => {
    const { rows, problems } = parseVoucherSheet(
      sheet([HEAD, ["01/11/2026", "OM-001", "Test Printer", "Banners", "2,500"], [], ["05/11/2026", "", "Test Van Hire", "", 4000.5], ["Total", "", "", "", 6500.5]]),
      "2026-11-18",
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { date: "2026-11-01", voucherNo: "OM-001", paidTo: "Test Printer", purpose: "Banners", amount: 250000 },
      { date: "2026-11-05", voucherNo: null, paidTo: "Test Van Hire", purpose: null, amount: 400050 },
    ]);
  });

  it("reports every unreadable row instead of guessing", () => {
    const { problems } = parseVoucherSheet(sheet([HEAD, ["31/11/2026", "", "Test", "", 100], ["02/11/2026", "", "", "", "abc"], ["30/12/2026", "", "Test", "", 50]]), "2026-11-18");
    expect(problems).toEqual([
      `Row 2: the date "31/11/2026" isn't a date (use dd/mm/yyyy)`,
      `Row 3: the amount "abc" isn't an amount`,
      "Row 3: who was paid is missing",
      "Row 4: 2026-12-30 is in the future",
    ]);
    expect(parseVoucherSheet(sheet([["Name", "Value"], ["x", 1]]), "2026-11-18").problems[0]).toMatch(/^No header row found/);
  });

  it("gives the same voucher the same identity on every upload, and two identical rows two", () => {
    const r = { date: "2026-11-01", voucherNo: null, paidTo: "Test Tea Stall", purpose: null, amount: 5000 };
    const once = voucherHashes([r, r]);
    expect(once[0]).not.toBe(once[1]);
    expect(voucherHashes([r, r])).toEqual(once);
    expect(voucherHashes([{ ...r, paidTo: "test  tea stall" }])[0]).toBe(once[0]);
  });
});
