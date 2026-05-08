"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * Thin top-of-page progress bar that appears as soon as a navigation begins
 * and completes when the new pathname renders. Gives the user instant
 * feedback during the 500–1500ms server-render window so navigation feels
 * responsive even when the page is genuinely working.
 */
function ProgressBar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const key = `${pathname}?${search.toString()}`;
  const prevKey = useRef(key);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    const start = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
      if (!target || target.target === "_blank") return;
      const href = target.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      // Same path? no nav.
      if (href === pathname) return;
      setProgress(10);
    };
    document.addEventListener("click", start, true);
    return () => document.removeEventListener("click", start, true);
  }, [pathname]);

  useEffect(() => {
    if (progress === null) return;
    // Creep upward while the new page is rendering.
    const id = setInterval(() => {
      setProgress((p) => (p === null ? null : Math.min(p + (90 - p) * 0.12, 90)));
    }, 120);
    return () => clearInterval(id);
  }, [progress]);

  useEffect(() => {
    if (key === prevKey.current) return;
    prevKey.current = key;
    if (progress === null) return;
    setProgress(100);
    const id = setTimeout(() => setProgress(null), 250);
    return () => clearTimeout(id);
  }, [key, progress]);

  if (progress === null) return null;
  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-[2000] pointer-events-none"
      style={{ height: 2 }}
    >
      <div
        className="h-full bg-primary transition-[width,opacity] duration-150"
        style={{
          width: `${progress}%`,
          opacity: progress >= 100 ? 0 : 1,
        }}
      />
    </div>
  );
}

export function RouteProgress() {
  // useSearchParams suspends; wrap so SSR doesn't fail.
  return (
    <Suspense fallback={null}>
      <ProgressBar />
    </Suspense>
  );
}
