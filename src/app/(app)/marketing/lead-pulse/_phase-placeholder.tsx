// Shared "this page lands in a later phase" placeholder. Stay consistent
// with the dark Lead Pulse theme and link the user back somewhere useful.
import Link from "next/link";

export function PhasePlaceholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="px-[24px] py-[40px] max-w-2xl mx-auto">
      <div
        className="rounded-[12px] p-[24px] border"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <div className="flex items-start gap-[12px] mb-[16px]">
          <span
            className="inline-flex items-center justify-center w-[40px] h-[40px] rounded-[8px]"
            style={{
              backgroundColor: "var(--lp-surface-container-high)",
              color: "var(--lp-primary)",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
              schedule
            </span>
          </span>
          <div>
            <h1 className="text-[20px] font-semibold">{title}</h1>
            <p
              className="text-[12px] uppercase tracking-widest mt-[4px]"
              style={{ color: "var(--lp-primary)" }}
            >
              Ships in {phase}
            </p>
          </div>
        </div>
        <p style={{ color: "var(--lp-on-surface-variant)" }}>{description}</p>
        <div className="mt-[20px]">
          <Link
            href="/marketing/lead-pulse"
            className="inline-flex items-center gap-[6px] h-[36px] px-[16px] rounded-[8px] text-[13px] font-semibold"
            style={{
              backgroundColor: "var(--lp-primary)",
              color: "var(--lp-on-primary)",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              arrow_back
            </span>
            Back to Lead Pulse
          </Link>
        </div>
      </div>
    </div>
  );
}
