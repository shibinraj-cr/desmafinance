export function inr(n: number | bigint | { toString(): string } | null | undefined): string {
  if (n === null || n === undefined) return "₹0";
  const num = typeof n === "number" ? n : Number(n.toString());
  if (!isFinite(num)) return "₹0";
  if (Math.abs(num) >= 10_00_000) return `₹${(num / 1_00_000).toFixed(2)}L`;
  if (Math.abs(num) >= 1_000) return `₹${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  return `₹${num.toFixed(0)}`;
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
