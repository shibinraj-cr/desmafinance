export function inr(n: number | bigint | { toString(): string } | null | undefined): string {
  if (n === null || n === undefined) return "₹0";
  const num = typeof n === "number" ? n : Number(n.toString());
  if (!isFinite(num)) return "₹0";
  if (Math.abs(num) >= 10_00_000) return `₹${(num / 1_00_000).toFixed(2)}L`;
  if (Math.abs(num) >= 1_000) return `₹${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  return `₹${num.toFixed(0)}`;
}

/**
 * Money at wealth scale, where a crore is the unit that reads naturally:
 * ₹2.13 Cr / ₹65.21 L / ₹28,500. `inr` stops at lakhs because that is the right
 * grain for a month of company revenue; a net-worth figure in lakhs is a wall
 * of digits, so the Personal Wealth desk uses this instead.
 */
export function inrCompact(n: number | bigint | { toString(): string } | null | undefined): string {
  if (n === null || n === undefined) return "₹0";
  const num = typeof n === "number" ? n : Number(n.toString());
  if (!isFinite(num)) return "₹0";
  const abs = Math.abs(num);
  if (abs >= 1_00_00_000) return `₹${(num / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `₹${(num / 1_00_000).toFixed(2)} L`;
  return `₹${Math.round(num).toLocaleString("en-IN")}`;
}

export function inrFull(n: number | bigint | { toString(): string } | null | undefined): string {
  if (n === null || n === undefined) return "₹0";
  const num = typeof n === "number" ? n : Number(n.toString());
  return `₹${num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function monthLabel(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const yr = String(d.getFullYear()).slice(-2);
  return `${months[d.getMonth()]}-${yr}`;
}

export function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}
