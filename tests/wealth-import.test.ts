import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  classify,
  date,
  dayOfMonth,
  frequency,
  money,
  parseGold,
  parseHoldings,
  parseLiabilities,
  readSheet,
  termYears,
} from "../src/lib/wealth-import";

// Every workbook here is synthetic and built in memory. The real one stays on
// the owner's machine — this repository is public — so what is under test is
// the reading of an ordinary, loosely-typed spreadsheet, not anyone's figures.

function book(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
  }
  return wb;
}

describe("money", () => {
  it("reads plain numbers and comma-grouped text", () => {
    expect(money(45000)).toBe(45000);
    expect(money("1,05,000")).toBe(105000);
  });

  it("expands crore and lakh shorthand", () => {
    expect(money("1 Cr")).toBe(10000000);
    expect(money("1.5 cr")).toBe(15000000);
    expect(money("12.5 L")).toBe(1250000);
    expect(money("50k")).toBe(50000);
  });

  it("takes a range at its midpoint — which is what a range in a premium column means", () => {
    expect(money("28000-29000")).toBe(28500);
    expect(money("28000 – 29000")).toBe(28500);
  });

  it("returns null for blanks and words", () => {
    expect(money(null)).toBeNull();
    expect(money("")).toBeNull();
    expect(money("Grams")).toBeNull();
  });
});

describe("date", () => {
  it("reads a real date cell", () => {
    expect(date(new Date(Date.UTC(2026, 9, 10)))).toBe("2026-10-10");
  });

  it("reads a written date, ordinal and all", () => {
    expect(date("as on 20th Dec 2024")).toBe("2024-12-20");
    expect(date("3 Feb 2026")).toBe("2026-02-03");
  });

  it("resolves a bare month to its last day, so a month-old valuation is not dated optimistically", () => {
    expect(date("as on mar 2026")).toBe("2026-03-31");
    expect(date("apr 2026")).toBe("2026-04-30");
    expect(date("feb 2028")).toBe("2028-02-29");
  });

  it("returns null for anything it cannot read", () => {
    expect(date("sometime soon")).toBeNull();
    expect(date(null)).toBeNull();
  });
});

describe("frequency and schedule", () => {
  it("maps the ways a schedule gets written", () => {
    expect(frequency("Monthly")).toBe("monthly");
    expect(frequency("Yearly")).toBe("yearly");
    expect(frequency("3 years")).toBe("three_yearly");
    expect(frequency("Single time")).toBe("one_time");
    expect(frequency("")).toBe("none");
    expect(frequency("10 account + 3 cash")).toBe("none");
  });

  it("reads a day of month, ordinal or bare", () => {
    expect(dayOfMonth("22nd ")).toBe(22);
    expect(dayOfMonth("10th October")).toBe(10);
    expect(dayOfMonth("5")).toBe(5);
  });

  it("treats a bare month name as an anchor, not a day", () => {
    expect(dayOfMonth("January")).toBeNull();
    expect(dayOfMonth("Dec")).toBeNull();
  });

  it("reads a term in years", () => {
    expect(termYears("12 Years")).toBe(12);
    expect(termYears("")).toBeNull();
  });
});

describe("classify", () => {
  it("places rows by product and institution words", () => {
    expect(classify("A mutual fund")).toBe("equity");
    expect(classify("Folio 1234 - MF")).toBe("equity");
    expect(classify("Some ULIP")).toBe("insurance");
    expect(classify("Term Insurance")).toBe("protection");
    expect(classify("Sukanya Samriddhi account")).toBe("savings");
    expect(classify("Personal Bank Balance")).toBe("cash");
  });

  it("leaves anything it cannot place uncategorised rather than guessing", () => {
    expect(classify("A private loan to someone")).toBe("other");
    expect(classify("Pending recovery")).toBe("other");
  });
});

describe("parseHoldings", () => {
  const wb = book({
    Money: [
      ["Sl No", "Plan", "Policy No", "Company", "SA", "Renewal", "Premium/investment", "Frequency", "Date", "Term", "Links", "Net Worth", "Column 1"],
      [1, "Term Insurance", "", "An Insurer", "75 L", "", 900, "Monthly", "22nd", "", "https://portal.example", "", ""],
      [2, "A ULIP", "POL-1", "A Life Co", "", new Date(Date.UTC(2026, 9, 10)), 450000, "Yearly", "10th October", "12 Years", "https://life.example", 400000, "as on 20th Dec 2023"],
      [3, "A mutual fund", "", "", "", "", "", "Monthly", "5th", "", "", 250000, "as on mar 2026"],
      [4, "Personal Bank Balance", "", "", "", "", 300000, "", "", "", "", 300000, "as on apr 2026"],
      [5, "A private advance", "", "", "", "", 500000, "", "", "", "", 500000, "as on mar 2026"],
      ["", "Total", "", "", "", "", "", "", "", "", "", 1450000, ""],
    ],
  });
  const rows = parseHoldings(readSheet(wb, "Money"));

  it("reads one holding per row and skips the total line", () => {
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.name)).not.toContain("Total");
  });

  it("keeps a monthly schedule as a day of month", () => {
    const term = rows.find((r) => r.name === "Term Insurance")!;
    expect(term.frequency).toBe("monthly");
    expect(term.dueDayOfMonth).toBe(22);
    expect(term.renewalOn).toBeNull();
  });

  it("keeps a yearly schedule as an anchor date, not a day", () => {
    const ulip = rows.find((r) => r.name === "A ULIP")!;
    expect(ulip.frequency).toBe("yearly");
    expect(ulip.renewalOn).toBe("2026-10-10");
    expect(ulip.dueDayOfMonth).toBeNull();
    expect(ulip.termYears).toBe(12);
    expect(ulip.policyNo).toBe("POL-1");
    expect(ulip.portalUrl).toBe("https://life.example");
  });

  it("carries the valuation and the date it was taken", () => {
    const ulip = rows.find((r) => r.name === "A ULIP")!;
    expect(ulip.value).toBe(400000);
    expect(ulip.valuedOn).toBe("2023-12-20");
    const fund = rows.find((r) => r.name === "A mutual fund")!;
    expect(fund.valuedOn).toBe("2026-03-31");
  });

  it("reads cover only for protection rows, so it never lands in the corpus", () => {
    const term = rows.find((r) => r.name === "Term Insurance")!;
    expect(term.assetClass).toBe("protection");
    expect(term.sumAssured).toBe(7500000);
    expect(term.value).toBeNull();
    const ulip = rows.find((r) => r.name === "A ULIP")!;
    expect(ulip.sumAssured).toBeNull();
  });

  it("leaves a row it cannot classify for the owner to place", () => {
    expect(rows.find((r) => r.name === "A private advance")!.assetClass).toBe("other");
  });

  it("reconciles: every value read adds up to the sheet's own total", () => {
    expect(rows.reduce((s, r) => s + (r.value ?? 0), 0)).toBe(1450000);
  });
});

describe("parseHoldings — a renewal date with no stated frequency", () => {
  it("keeps the date as a one-off instead of dropping it", () => {
    const wb = book({
      Money: [
        ["Plan", "Renewal", "Frequency", "Net Worth"],
        ["A policy", new Date(Date.UTC(2026, 11, 1)), "", 600000],
      ],
    });
    const [row] = parseHoldings(readSheet(wb, "Money"));
    expect(row.frequency).toBe("one_time");
    expect(row.renewalOn).toBe("2026-12-01");
  });
});

describe("parseGold", () => {
  const wb = book({
    Gold: [
      ["Bangles", null, null, null, null, null, null],
      ["Bangle one", 10, null, null, null, null, null],
      ["Bangle two", 20, null, null, null, "Grams", "Pavan"],
      ["Bangle three", 30, null, null, "Total", 105, 13.125],
      ["Bangle four", 5, null, null, null, 9200, null],
      [null, null, null, null, null, null, 966000],
      ["Chains", null, null, null, null, null, null],
      ["Chain one", 25, null, null, null, null, null],
      ["Coins", null, null, null, null, null, null],
      ["Scheme instalment", 15, null, "Due on", new Date(Date.UTC(2026, 5, 23)), null, null],
    ],
  });
  const { items, ratePerGram } = parseGold(wb, "Gold");

  it("files each piece under the heading above it", () => {
    expect(items.filter((i) => i.category === "Bangles")).toHaveLength(4);
    expect(items.filter((i) => i.category === "Chains")).toHaveLength(1);
    expect(items.filter((i) => i.category === "Coins")).toHaveLength(1);
  });

  it("treats a heading as a heading, not a weightless piece", () => {
    expect(items.map((i) => i.name)).not.toContain("Bangles");
  });

  it("totals the weights", () => {
    expect(items.reduce((s, i) => s + i.grams, 0)).toBe(105);
  });

  it("finds the rate in the summary block even though it shares a row with a piece", () => {
    expect(ratePerGram).toBe(9200);
  });

  it("does not mistake the grams total or the computed value for the rate", () => {
    expect(ratePerGram).not.toBe(105);
    expect(ratePerGram).not.toBe(966000);
  });

  it("keeps a scheme delivery date", () => {
    expect(items.find((i) => i.name === "Scheme instalment")!.dueOn).toBe("2026-06-23");
  });

  it("returns nothing for a workbook with no gold sheet", () => {
    expect(parseGold(book({ Money: [["Plan"]] }), "Gold")).toEqual({ items: [], ratePerGram: null });
  });
});

describe("parseLiabilities", () => {
  const wb = book({
    Money: [
      ["Plan", "Net Worth", "", "", "", "", "", "", "", "", "", "Label", "Amount"],
      ["A holding", 100, "", "", "", "", "", "", "", "", "", "Housing Loan", 12.5],
      ["", "", "", "", "", "", "", "", "", "", "", "Car Loan", 8],
      ["", "", "", "", "", "", "", "", "", "", "", "Gold Loan", 0],
    ],
  });
  const rows = parseLiabilities(wb, "Money");

  it("finds borrowings in the summary block", () => {
    expect(rows.map((r) => r.kind).sort()).toEqual(["car", "gold", "housing"]);
  });

  it("scales the block's lakh figures into rupees", () => {
    expect(rows.find((r) => r.kind === "housing")!.outstanding).toBe(1250000);
    expect(rows.find((r) => r.kind === "car")!.outstanding).toBe(800000);
  });

  it("keeps a closed borrowing at zero rather than dropping it", () => {
    expect(rows.find((r) => r.kind === "gold")!.outstanding).toBe(0);
  });

  it("leaves a figure already written in rupees alone", () => {
    const big = book({
      Money: [["", "", "", "", "", "", "", "", "", "", "", "Personal Loan", 250000]],
    });
    expect(parseLiabilities(big, "Money")[0].outstanding).toBe(250000);
  });
});

describe("readSheet", () => {
  it("says which sheets exist when the named one does not", () => {
    expect(() => readSheet(book({ Money: [["Plan"]] }), "Nope")).toThrow(/Money/);
  });
});

describe("date — Excel serials", () => {
  it("reads a serial a workbook handed over without cellDates", () => {
    // 46305 is 10 Oct 2026 on Excel's 1900 epoch.
    expect(date(46305)).toBe("2026-10-10");
    expect(date(46296)).toBe("2026-10-01");
  });

  it("refuses numbers that cannot be a date, so a day or a weight is never read as one", () => {
    expect(date(22)).toBeNull();
    expect(date(483)).toBeNull();
    expect(date(9200)).toBeNull();
  });
});
