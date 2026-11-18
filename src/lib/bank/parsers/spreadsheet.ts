import * as XLSX from "xlsx";
import { BankAutomationError } from "../errors";
import { isoIfValid } from "../email-parse";
import { parseAmount, type Paise } from "../money";
import { reconcileDirections, type ParsedRow, type ParsedStatement, type StatementSummary } from "./base";

/**
 * Net-banking statement downloads in Excel form, read straight into the same
 * ParsedStatement the PDF parsers produce, so validation, de-duplication and
 * import are shared:
 *
 *   HDFC  .xls  (BIFF8). A header block, then
 *         Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. | Deposit Amt. | Closing Balance
 *         between rows of asterisks, then a STATEMENT SUMMARY block
 *         (Opening Balance … Debits | Credits | Closing Bal, then Dr Count | Cr Count).
 *         Dates are dd/mm/yy text, amounts numbers.
 *   Axis  .xlsx. A header block, then
 *         S.NO | Transaction Date (dd/mm/yyyy) | Value Date (dd/mm/yyyy) | Particulars | Amount(INR) |
 *         Debit/Credit | Balance(INR) | Cheque Number | Branch Name(SOL)
 *         with OPENING BALANCE, TRANSACTION TOTAL DR/CR ("debits/credits") and CLOSING BALANCE as
 *         rows of the table. Dates are dd/mm/yyyy text, amounts "1,23,456.78" text.
 *
 * Columns are found by what the header says (with any "(dd/mm/yyyy)" / "(INR)"
 * hint removed), never by position, so a re-ordered or re-saved file still
 * reads. A date cell Excel converted on a re-save is read from its serial.
 */

export const SHEET_STRATEGY = "sheet/1";

/** Statement spreadsheets are small; anything bigger is not one. */
export const MAX_SHEET_BYTES = 4 * 1024 * 1024;

type Col = "serial" | "date" | "valueDate" | "narration" | "ref" | "cheque" | "debit" | "credit" | "amount" | "drcr" | "balance";

const HEADERS: Array<[Col, RegExp]> = [
  ["serial", /^(s\.? ?no\.?|sr\.? ?no\.?|sl\.? ?no\.?)$/],
  ["valueDate", /^value (dt|date)\.?$/],
  ["date", /^(tran(saction)?\.? date|txn\.? date|posting date|date)$/],
  ["narration", /^(narration|particulars|transaction particulars|description|remarks)$/],
  ["ref", /^(chq\.? ?\/ ?ref\.? ?no\.?|ref(erence)?\.? ?(no\.?|number)|utr( no\.?)?)$/],
  ["cheque", /^(cheque (no\.?|number)|chq\.? ?no\.?)$/],
  ["debit", /^(withdrawal amt\.?|withdrawal amount|withdrawals?|debit amount|debits?)$/],
  ["credit", /^(deposit amt\.?|deposit amount|deposits?|credit amount|credits?)$/],
  ["drcr", /^(debit ?\/ ?credit|dr ?\/ ?cr|cr ?\/ ?dr)$/],
  ["amount", /^(amount|transaction amount)$/],
  ["balance", /^(closing balance|balance)$/],
];

const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());

/** "Transaction Date (dd/mm/yyyy)" → "transaction date"; "Amount(INR)" → "amount". */
export function headerKey(v: unknown): string {
  return text(v)
    .replace(/\((?:dd|mm|yy)[^)]*\)/gi, "")
    .replace(/\(\s*(?:inr|₹|rs\.?)\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function columnOf(cell: unknown): Col | null {
  const k = headerKey(cell);
  if (!k || k.length > 40) return null;
  for (const [col, re] of HEADERS) if (re.test(k)) return col;
  return null;
}

type ColMap = Partial<Record<Col, number>>;

function headerMap(row: unknown[]): ColMap | null {
  const map: ColMap = {};
  row.forEach((c, i) => {
    const col = columnOf(c);
    if (col && map[col] === undefined) map[col] = i;
  });
  const split = map.debit !== undefined && map.credit !== undefined;
  const single = map.amount !== undefined && map.drcr !== undefined;
  return map.date !== undefined && map.narration !== undefined && map.balance !== undefined && (split || single) ? map : null;
}

/** A statement date: "dd/mm/yy", "dd/mm/yyyy", "dd-mm-yyyy", "dd-Mon-yyyy", or an Excel serial. */
export function sheetDate(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v < 20_000 || v > 80_000) return null;
    const d = XLSX.SSF.parse_date_code(v);
    return d ? isoIfValid(d.y, d.m, d.d) : null;
  }
  const s = text(v);
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoIfValid(y, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s,-]+(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mo = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return mo ? isoIfValid(y, mo, Number(m[1])) : null;
  }
  return null;
}

/** A money cell: a number, or text such as "1,23,456.78" / "1234.5". Blank → null. */
export function sheetAmount(v: unknown): Paise | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = text(v);
  if (!s || /^[-–—]+$/.test(s)) return null;
  return parseAmount(s);
}

/** The bank a workbook belongs to, from its IFSC or its name in the header block. */
export function detectBank(headerText: string, map: ColMap): string | null {
  if (/\bUTIB0\w{6}\b/i.test(headerText) || /axis\s*bank/i.test(headerText)) return "AXIS";
  if (/\bHDFC0\w{6}\b/i.test(headerText) || /hdfc\s*bank/i.test(headerText)) return "HDFC";
  // Fall back on the table's shape: split withdrawal/deposit is HDFC's, one amount + Dr/Cr is Axis's.
  if (map.debit !== undefined && map.credit !== undefined) return "HDFC";
  if (map.amount !== undefined && map.drcr !== undefined) return "AXIS";
  return null;
}

export type SheetStatement = { bankCode: string; parsed: ParsedStatement };

/** True when the bytes are a spreadsheet DesGro reads as a statement (xlsx zip or BIFF .xls). */
export function looksLikeSpreadsheet(buf: Uint8Array): boolean {
  if (buf.length < 8) return false;
  const zip = buf[0] === 0x50 && buf[1] === 0x4b;
  const ole = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  return zip || ole;
}

/**
 * Read a statement workbook. `bankHint` (the account the upload was aimed at)
 * wins over detection; a workbook that names a different bank is refused.
 */
export function parseStatementWorkbook(buf: Uint8Array, bankHint: string | null = null): SheetStatement {
  if (!looksLikeSpreadsheet(buf)) {
    throw new BankAutomationError("PARSE_FAILED", "This file is not an Excel statement (.xls or .xlsx)");
  }
  let wb: XLSX.WorkBook;
  try {
    // Values as stored: numbers stay numbers, text stays text. Dates are read
    // from the text the bank wrote (or an Excel serial), never re-interpreted.
    wb = XLSX.read(buf, { type: "array", cellDates: false, cellNF: false, cellHTML: false, cellStyles: false, sheetRows: 20_000 });
  } catch (e) {
    throw new BankAutomationError("PARSE_FAILED", `The spreadsheet could not be opened: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: true, defval: "", blankrows: true });
    const hdr = grid.findIndex((r, i) => i < 80 && headerMap(r) !== null);
    if (hdr < 0) continue;
    const map = headerMap(grid[hdr])!;
    const headerText = grid.slice(0, hdr).map((r) => r.map(text).filter(Boolean).join(" ")).join("\n");
    const detected = detectBank(headerText, map);
    const bankCode = (bankHint ?? detected ?? "").toUpperCase();
    if (!bankCode) throw new BankAutomationError("PARSE_FAILED", "Could not tell which bank this statement is from");
    if (bankHint && detected && detected !== bankHint.toUpperCase()) {
      throw new BankAutomationError("PARSE_FAILED", `This looks like a ${detected} statement, not ${bankHint.toUpperCase()}`);
    }
    return { bankCode, parsed: readTable(grid, hdr, map, headerText, bankCode) };
  }
  throw new BankAutomationError("PARSE_FAILED", "No transaction table found: expected Date, Narration/Particulars, amounts and Balance columns");
}

const SEPARATOR = /^\*{3,}$/;

function readTable(grid: unknown[][], hdr: number, map: ColMap, headerText: string, bankCode: string): ParsedStatement {
  const rows: ParsedRow[] = [];
  const anomalies: string[] = [];
  const warnings: string[] = [];
  let openingBalance: Paise | null = null;
  let closingBalance: Paise | null = null;
  let totals: { debit: Paise; credit: Paise } | null = null;
  let end = grid.length;

  const at = (r: unknown[], c: Col): unknown => (map[c] === undefined ? "" : r[map[c]!]);

  for (let i = hdr + 1; i < grid.length; i++) {
    const r = grid[i];
    const cells = r.map(text);
    const first = cells.find(Boolean) ?? "";
    if (!first) {
      // A blank row after data ends the table (HDFC); before any data, skip it.
      if (rows.length) {
        end = i;
        break;
      }
      continue;
    }
    if (SEPARATOR.test(first)) {
      if (rows.length) {
        end = i;
        break;
      }
      continue;
    }

    const narration = text(at(r, "narration"));
    const label = narration.toUpperCase();
    // Axis carries its balances and totals as rows of the table.
    if (label === "OPENING BALANCE") {
      openingBalance = sheetAmount(at(r, "balance"));
      continue;
    }
    if (label === "CLOSING BALANCE") {
      closingBalance = sheetAmount(at(r, "balance"));
      end = i + 1;
      break;
    }
    if (/^TRANSACTION TOTAL/.test(label)) {
      const [d, c] = text(at(r, "amount") || at(r, "debit")).split("/");
      const debit = sheetAmount(d);
      const credit = sheetAmount(c);
      if (debit !== null && credit !== null) totals = { debit, credit };
      continue;
    }

    const date = sheetDate(at(r, "date"));
    if (!date) {
      // HDFC wraps a long narration onto a row of its own: no date, no amounts.
      const noMoney = sheetAmount(at(r, "debit")) === null && sheetAmount(at(r, "credit")) === null && sheetAmount(at(r, "amount")) === null;
      if (narration && noMoney && rows.length) {
        const prev = rows[rows.length - 1];
        prev.description = `${prev.description} ${narration}`.trim();
        prev.rawText = `${prev.rawText} ${narration}`.trim();
        continue;
      }
      if (/statement summary|^opening balance/i.test(first)) {
        end = i;
        break;
      }
      warnings.push(`Row ${i + 1} skipped: no transaction date`);
      continue;
    }

    let debit: Paise = 0;
    let credit: Paise = 0;
    if (map.debit !== undefined && map.credit !== undefined) {
      debit = sheetAmount(at(r, "debit")) ?? 0;
      credit = sheetAmount(at(r, "credit")) ?? 0;
    } else {
      const amount = sheetAmount(at(r, "amount"));
      const side = text(at(r, "drcr")).toUpperCase();
      if (amount === null) anomalies.push(`Row ${i + 1} (${date}) has no amount`);
      else if (/^D/.test(side)) debit = amount;
      else if (/^C/.test(side)) credit = amount;
      else anomalies.push(`Row ${i + 1} (${date}) is neither DR nor CR ("${side}")`);
    }
    const ref = text(at(r, "ref")) || null;
    const cheque = text(at(r, "cheque")) || null;
    rows.push({
      rowIndex: rows.length,
      txnDate: date,
      valueDate: sheetDate(at(r, "valueDate")),
      description: narration,
      referenceNumber: ref ?? cheque,
      chequeNumber: cheque,
      debit,
      credit,
      balance: sheetAmount(at(r, "balance")),
      rawText: [date, narration, ref ?? cheque ?? "", debit ? `-${debit / 100}` : `+${credit / 100}`].join(" | "),
    });
  }

  // HDFC: the STATEMENT SUMMARY block under the table.
  let summary: StatementSummary | null = null;
  const tail = grid.slice(end);
  const sumHdr = tail.findIndex((r) => r.some((c) => /^opening balance$/i.test(text(c))));
  if (sumHdr >= 0) {
    const labels = tail[sumHdr].map((c) => text(c).toLowerCase());
    const values = tail.slice(sumHdr + 1).find((r) => r.some((c) => text(c) !== "")) ?? [];
    const val = (re: RegExp) => {
      const idx = labels.findIndex((l) => re.test(l));
      return idx < 0 ? null : sheetAmount(values[idx]);
    };
    const opening = val(/^opening balance$/);
    const debits = val(/^debits?$/);
    const credits = val(/^credits?$/);
    const closing = val(/^closing bal/);
    const countHdr = tail.findIndex((r) => r.some((c) => /^dr count$/i.test(text(c))));
    let drCount: number | null = null;
    let crCount: number | null = null;
    if (countHdr >= 0) {
      const cl = tail[countHdr].map((c) => text(c).toLowerCase());
      const cv = tail.slice(countHdr + 1).find((r) => r.some((c) => text(c) !== "")) ?? [];
      const n = (re: RegExp) => {
        const idx = cl.findIndex((l) => re.test(l));
        const v = idx < 0 ? NaN : Number(text(cv[idx]).replace(/,/g, ""));
        return Number.isInteger(v) ? v : null;
      };
      drCount = n(/^dr count$/);
      crCount = n(/^cr count$/);
    }
    if (opening !== null) openingBalance = opening;
    if (closing !== null) closingBalance = closing;
    if (opening !== null && closing !== null && debits !== null && credits !== null) {
      summary = { openingBalance: opening, closingBalance: closing, totalDebit: debits, totalCredit: credits, debitCount: drCount, creditCount: crCount };
    }
  } else if (totals && openingBalance !== null && closingBalance !== null) {
    summary = { openingBalance, closingBalance, totalDebit: totals.debit, totalCredit: totals.credit, debitCount: null, creditCount: null };
  }

  if (openingBalance === null && rows.length && rows[0].balance !== null) {
    openingBalance = rows[0].balance - rows[0].credit + rows[0].debit;
    warnings.push("No opening balance on the statement: worked out from the first row");
  }
  if (closingBalance === null && rows.length && rows[rows.length - 1].balance !== null) {
    closingBalance = rows[rows.length - 1].balance;
  }

  reconcileDirections(rows, openingBalance, anomalies);

  const account = /account\s*(?:no|number)\.?\s*[:-]?\s*\**\s*(\d{6,20})/i.exec(headerText);
  const period = /from\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*to\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i.exec(headerText);
  const periodStart = period ? sheetDate(period[1]) : rows[0]?.txnDate ?? null;
  const periodEnd = period ? sheetDate(period[2]) : rows[rows.length - 1]?.txnDate ?? null;
  if (!period) warnings.push("Statement period not found: taken from the first and last rows");

  return {
    bankCode,
    strategy: SHEET_STRATEGY,
    accountNumber: account ? account[1] : null,
    periodStart,
    periodEnd,
    openingBalance,
    closingBalance,
    summary,
    rows,
    anomalies,
    warnings,
  };
}
