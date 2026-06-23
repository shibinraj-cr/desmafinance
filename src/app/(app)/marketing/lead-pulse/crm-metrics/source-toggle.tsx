"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Source = "daily_entry" | "crm";

/** Supervisor toggle that flips which source the LIVE dashboards read from. */
export function SourceToggle({ source }: { source: Source }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState<Source>(source);

  async function flip(next: Source) {
    if (busy || next === cur) return;
    setBusy(true);
    const res = await fetch("/api/marketing/lead-pulse/metrics-source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: next }),
    });
    setBusy(false);
    if (res.ok) {
      setCur(next);
      router.refresh();
    }
  }

  return (
    <div
      className="rounded-[12px] p-[12px] border flex flex-wrap items-center gap-[10px]"
      style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
    >
      <span className="text-[13px] font-semibold" style={{ color: "var(--lp-on-surface)" }}>
        Live dashboards read from:
      </span>
      <div className="inline-flex rounded-[8px] overflow-hidden border" style={{ borderColor: "var(--lp-outline-variant)" }}>
        {(["daily_entry", "crm"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => flip(s)}
            className="px-[14px] h-[32px] text-[13px] font-semibold transition disabled:opacity-60"
            style={{
              backgroundColor: cur === s ? "var(--lp-primary)" : "transparent",
              color: cur === s ? "var(--lp-on-primary)" : "var(--lp-on-surface-variant)",
            }}
          >
            {s === "daily_entry" ? "Daily entry" : "CRM"}
          </button>
        ))}
      </div>
      <span className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
        {cur === "crm"
          ? "L2 Targets actuals and the Closed-Won KPI now come from CRM enrollments. Flip back any time."
          : "Default — the daily entry feeds the live dashboards. Flip to CRM once every close is enrolled in the CRM."}
      </span>
    </div>
  );
}
