import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { gstInAmount, netOfGst } from "@/lib/finance-gst";
import { splitGst } from "@/lib/invoices/core";

const rev = (over: Partial<{ type: string; paymentMode: string; expDom: string | null; amount: number }> = {}) => ({
  type: "Revenue",
  paymentMode: "Axis Bank",
  expDom: "DOM",
  amount: 34220,
  ...over,
});

describe("gstInAmount", () => {
  it("takes 18% GST out of domestic Axis and HDFC revenue", () => {
    expect(gstInAmount(rev())).toBe(5220);
    expect(gstInAmount(rev({ paymentMode: "HDFC Bank" }))).toBe(5220);
    expect(netOfGst(34220, gstInAmount(rev()))).toBe(29000);
  });

  it("carries none on export, Wio, cash, UPI, cards, RCS, STR or expenses", () => {
    expect(gstInAmount(rev({ expDom: "EXP" }))).toBe(0);
    expect(gstInAmount(rev({ expDom: null }))).toBe(0);
    for (const paymentMode of ["Wio Bank", "Cash", "UPI", "Credit Card", "Debit Card", "RCS", "STR"]) {
      expect(gstInAmount(rev({ paymentMode }))).toBe(0);
    }
    expect(gstInAmount(rev({ type: "Expense" }))).toBe(0);
    expect(gstInAmount(rev({ amount: 0 }))).toBe(0);
  });

  it("reads Prisma Decimals and strings", () => {
    expect(gstInAmount({ ...rev(), amount: { toString: () => "34220.00" } })).toBe(5220);
    expect(gstInAmount({ ...rev(), amount: "10001" })).toBe(1525.58);
  });

  it("matches the GST the invoice prints, to the paisa", () => {
    for (const g of [1, 99.99, 10001, 34220, 123456.78, 50000, 33333.33]) {
      const s = splitGst(g, true);
      expect(gstInAmount(rev({ amount: g }))).toBeCloseTo(s.cgst + s.sgst, 2);
      expect(netOfGst(g, gstInAmount(rev({ amount: g })))).toBeCloseTo(s.taxable, 2);
    }
  });

  it("agrees with the migration's SQL backfill: amount - ROUND(amount / 1.18, 2)", () => {
    // Postgres ROUND on numeric is half away from zero; 18/118 never lands on a half paisa.
    const sql = (g: number) => Math.round((g - Math.round((g / 1.18) * 100 + 1e-9) / 100) * 100) / 100;
    for (const g of [1, 2.5, 17.7, 1180, 34220, 99999.99, 765432.1]) expect(gstInAmount(rev({ amount: g }))).toBe(sql(g));
  });
});

// ── every ledger write sets gstAmount ────────────────────────────────────────

const ROOT = join(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
function callArgs(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(openParen, i + 1);
  }
  return src.slice(openParen);
}
const WRITE = /(?<!["'`\w])transaction\s*\.\s*(create|createMany|update|updateMany|upsert)\s*\(/g;

describe("ledger writes keep the GST in step", () => {
  it("every Transaction write that sets the amount or EXP/DOM also sets gstAmount", () => {
    const missing: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(WRITE)) {
        const args = callArgs(src, m.index! + m[0].length - 1);
        if (/\b(amount|expDom|paymentMode)\s*:/.test(args) && !args.includes("gstAmount")) {
          missing.push(`${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(missing, "Set gstAmount: gstInAmount(...) (src/lib/finance-gst.ts) on these ledger writes").toEqual([]);
  });
});
