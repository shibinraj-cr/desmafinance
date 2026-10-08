"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { fyName } from "@/lib/mkt-planner-shared";

/** Financial-year picker; keeps the rest of the query string. */
export function FySelect({ fy, fys }: { fy: number; fys: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-[6px] text-[12px]" style={{ color: "var(--lp-outline)" }}>
      Year
      <select
        value={fy}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          next.set("fy", e.target.value);
          next.delete("q");
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="rounded-[8px] px-[10px] min-h-[40px] text-[13px] border outline-none"
        style={{
          backgroundColor: "var(--lp-surface-container-high)",
          borderColor: "var(--lp-outline-variant)",
          color: "var(--lp-on-surface)",
        }}
      >
        {fys.map((y) => (
          <option key={y} value={y}>
            {fyName(y)}
          </option>
        ))}
      </select>
    </label>
  );
}
