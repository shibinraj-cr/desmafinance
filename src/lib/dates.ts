/**
 * Parse a date value coming from sources we don't fully control:
 *  - JS Date — passed through
 *  - Excel serial number (days since 1899-12-30) — converted
 *  - Strings in dd-mm-yyyy or dd/mm/yyyy (Indian/UK) — explicit match
 *  - Anything else — fall back to native Date parsing
 *
 * Returns null when the input cannot be parsed. Used by the Excel
 * importer; safe to use anywhere we accept user-pasted dates.
 */
export function parseLooseDate(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(+v) ? null : v;

  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400000);
    return isNaN(+d) ? null : d;
  }

  if (typeof v === "string" && v) {
    const s = v.trim();
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
      return isNaN(+d) ? null : d;
    }
    const d = new Date(s);
    return isNaN(+d) ? null : d;
  }

  return null;
}
