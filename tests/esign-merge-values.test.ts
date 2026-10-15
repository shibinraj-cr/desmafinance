import { describe, expect, it } from "vitest";
import {
  amountInWords,
  deriveMergeValues,
  formatINR,
  formatLongDate,
  integerInWords,
  missingMergeKeys,
  parseAmount,
  resolveMergeValues,
} from "@/lib/esign/merge-values";

describe("rupees", () => {
  it("formats with lakh grouping and paise only when present", () => {
    expect(formatINR(150000)).toBe("₹1,50,000");
    expect(formatINR(12345678.5)).toBe("₹1,23,45,678.50");
    expect(formatINR(0)).toBe("₹0");
  });

  it("parses what staff type", () => {
    expect(parseAmount("₹1,50,000")).toBe(150000);
    expect(parseAmount(" Rs. 2,500.75 ")).toBe(2500.75);
    expect(parseAmount("INR 900")).toBe(900);
    expect(parseAmount("one lakh")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("writes amounts in the Indian system", () => {
    expect(integerInWords(0)).toBe("Zero");
    expect(integerInWords(15)).toBe("Fifteen");
    expect(integerInWords(101)).toBe("One Hundred One");
    expect(integerInWords(150000)).toBe("One Lakh Fifty Thousand");
    expect(integerInWords(12345678)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
    expect(integerInWords(1000000000)).toBe("One Hundred Crore");
    expect(amountInWords(150000)).toBe("Rupees One Lakh Fifty Thousand Only");
    expect(amountInWords(2500.5)).toBe("Rupees Two Thousand Five Hundred and Fifty Paise Only");
  });
});

describe("dates", () => {
  it("prints unambiguous long dates in IST", () => {
    // 20:00 UTC on 14 Oct is already 15 Oct in India.
    expect(formatLongDate(new Date("2026-10-14T20:00:00Z"))).toBe("15 October 2026");
    // A date-only value (dob) must not shift a day either way.
    expect(formatLongDate(new Date("1995-03-12T00:00:00Z"), { dateOnly: true })).toBe("12 March 1995");
  });
});

describe("resolving and deriving", () => {
  const lead = {
    candidateName: "  Test Candidate ",
    email: "candidate@example.com",
    phone: "+91 98765 43210",
    dob: new Date("1995-03-12T00:00:00Z"),
    serviceName: "AHPRA Registration",
    expectedValue: 150000,
  };

  it("fills CRM keys, leaves manual keys blank, derives the rest", () => {
    const v = resolveMergeValues(
      ["client.full_name", "client.dob", "client.passport_no", "deal.fee_amount", "deal.fee_in_words", "deal.total_amount", "today", "staff.name"],
      { lead, staffName: "Ops Staff", now: new Date("2026-10-15T05:00:00Z") },
    );
    expect(v["client.full_name"]).toMatchObject({ value: "Test Candidate", origin: "lead" });
    expect(v["client.dob"].value).toBe("12 March 1995");
    expect(v["client.passport_no"]).toMatchObject({ value: "", origin: "manual" });
    expect(v["deal.fee_amount"].value).toBe("₹1,50,000");
    expect(v["deal.fee_in_words"].value).toBe("Rupees One Lakh Fifty Thousand Only");
    // No GST entered yet: the total is the fee.
    expect(v["deal.total_amount"].value).toBe("₹1,50,000");
    expect(v.today.value).toBe("15 October 2026");
    expect(v["staff.name"].value).toBe("Ops Staff");
    expect(Object.keys(v)).toHaveLength(8);
  });

  it("recomputes derived values unless staff overrode them", () => {
    const base = { "deal.fee_amount": "₹1,00,000", "deal.gst_amount": "18,000" };
    expect(deriveMergeValues(base, new Set())).toMatchObject({
      "deal.total_amount": "₹1,18,000",
      "deal.fee_in_words": "Rupees One Lakh Only",
    });
    const kept = deriveMergeValues({ ...base, "deal.total_amount": "As per schedule" }, new Set(["deal.total_amount"]));
    expect(kept["deal.total_amount"]).toBe("As per schedule");
    // An unreadable GST leaves the total for staff rather than guessing.
    expect(deriveMergeValues({ "deal.fee_amount": "100", "deal.gst_amount": "tbd" }, new Set())["deal.total_amount"]).toBe("");
  });

  it("lists what still needs a value", () => {
    expect(missingMergeKeys(["a", "b", "c"], { a: "x", b: "  " })).toEqual(["b", "c"]);
  });
});
