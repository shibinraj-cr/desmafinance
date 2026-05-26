"use client";

export function PrintButton({ label = "Download / Print PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="px-4 py-2 rounded bg-primary text-on-primary font-semibold text-sm"
    >
      {label}
    </button>
  );
}
