import { BankAutomationError } from "../errors";
import type { BaseBankStatementParser } from "./base";
import { HDFCStatementParser } from "./hdfc";

/**
 * Bank code → statement parser. A new bank (ICICI, SBI, Axis, Federal, Kotak…)
 * is one BaseBankStatementParser subclass added here; the engine looks the
 * parser up by the integration's `bankCode` and nothing else changes.
 */
const PARSERS: Record<string, () => BaseBankStatementParser> = {
  HDFC: () => new HDFCStatementParser(),
};

export const SUPPORTED_BANKS = Object.keys(PARSERS);

export function parserFor(bankCode: string): BaseBankStatementParser {
  const make = PARSERS[bankCode.toUpperCase()];
  if (!make) throw new BankAutomationError("CONFIG", `No statement parser for bank "${bankCode}"`);
  return make();
}
