/** "₹34,220", "AED 1,400", "CAD 624.08": the register's money, in the invoice's own currency. */
export function money(n: number, currency: string): string {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  if (currency === "INR") return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return `${currency} ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function cell(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  // Quote anything with a separator, a quote or a line break; neutralise
  // leading =+-@ so a spreadsheet never runs a name as a formula.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadCsv(name: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
