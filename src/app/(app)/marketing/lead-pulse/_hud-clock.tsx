"use client";

import { useEffect, useState } from "react";

/**
 * Cosmetic HUD clock for the Lead Pulse header band. Ticks an IST `HH:MM:SS`
 * readout in the mono face. Purely decorative — no data, no props. Renders a
 * blank placeholder until mounted so server and client markup agree (the live
 * time would otherwise differ between SSR and hydration).
 */
export function HudClock() {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    });
    const tick = () => setTime(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="font-mono tabular-nums text-[12px] tracking-[0.12em]"
      style={{ color: "var(--lp-primary)", minWidth: "8ch", textAlign: "right" }}
      suppressHydrationWarning
    >
      {time || "--:--:--"}
    </span>
  );
}
