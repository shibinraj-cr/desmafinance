import { STATUS_LABELS } from "@/lib/esign/requests";

const TONES: Record<string, string> = {
  draft: "bg-surface-container text-on-surface-variant border-outline-variant",
  sent: "bg-sky-50 text-sky-800 border-sky-200",
  viewed: "bg-indigo-50 text-indigo-800 border-indigo-200",
  partially_signed: "bg-amber-50 text-amber-900 border-amber-200",
  signed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  declined: "bg-red-50 text-red-800 border-red-200",
  expired: "bg-stone-100 text-stone-700 border-stone-300",
  cancelled: "bg-stone-100 text-stone-600 border-stone-300",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={"inline-flex items-center px-xs py-[1px] rounded border text-caption font-semibold whitespace-nowrap " + (TONES[status] ?? TONES.draft)}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
