"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Service = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  showInL2Targets: boolean;
};

export function ServiceVisibilityClient({ services }: { services: Service[] }) {
  const router = useRouter();
  const [state, setState] = useState<Service[]>(services);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function toggle(serviceId: string, next: boolean) {
    setError(null);
    setState((arr) =>
      arr.map((s) => (s.id === serviceId ? { ...s, showInL2Targets: next } : s)),
    );
    startTransition(async () => {
      const res = await fetch("/api/marketing/lead-pulse/targets/services", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId, showInL2Targets: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { error?: string }).error ?? "Update failed.");
        // revert
        setState((arr) =>
          arr.map((s) => (s.id === serviceId ? { ...s, showInL2Targets: !next } : s)),
        );
        return;
      }
      router.refresh();
    });
  }

  const shown = state.filter((s) => s.showInL2Targets).length;
  const hidden = state.filter((s) => !s.showInL2Targets).length;

  return (
    <div className="px-[24px] py-[24px] space-y-[16px] max-w-3xl">
      <header className="flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">L2 Target Services</h1>
          <p className="mt-[4px] text-[13px]" style={{ color: "var(--lp-on-surface-variant)" }}>
            Toggle which services appear as columns on the L2 Targets sheet. Hiding a
            service preserves its historical targets but takes it out of the editing
            matrix.
          </p>
        </div>
        <Link
          href="/marketing/lead-pulse/targets"
          className="h-[36px] inline-flex items-center px-[14px] rounded-[8px] border text-[13px] font-semibold"
          style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface)" }}
        >
          ← Back to L2 Targets
        </Link>
      </header>

      <div
        className="rounded-[10px] border p-[12px] text-[12px] flex items-center gap-[12px]"
        style={{
          backgroundColor: "var(--lp-surface-container-low)",
          borderColor: "var(--lp-outline-variant)",
          color: "var(--lp-on-surface-variant)",
        }}
      >
        <span>
          <span className="font-bold tabular-nums" style={{ color: "var(--lp-primary)" }}>
            {shown}
          </span>{" "}
          shown on the matrix
        </span>
        <span>·</span>
        <span>
          <span className="font-bold tabular-nums" style={{ color: "var(--lp-on-surface)" }}>
            {hidden}
          </span>{" "}
          hidden
        </span>
      </div>

      {error && (
        <p className="text-[12px]" style={{ color: "var(--lp-error)" }}>
          {error}
        </p>
      )}

      <ul
        className="rounded-[12px] border divide-y"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        {state.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-[12px] px-[16px] py-[12px]"
            style={{ borderColor: "var(--lp-outline-variant)" }}
          >
            <div className="flex-1 min-w-0">
              <p
                className="text-[14px] font-semibold"
                style={{ color: s.isActive ? "var(--lp-on-surface)" : "var(--lp-on-surface-variant)" }}
              >
                {s.name}
                {!s.isActive && (
                  <span
                    className="ml-[8px] text-[10px] uppercase tracking-widest"
                    style={{ color: "var(--lp-on-surface-variant)" }}
                  >
                    inactive
                  </span>
                )}
              </p>
              {s.description && (
                <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                  {s.description}
                </p>
              )}
            </div>
            <label className="inline-flex items-center gap-[8px] cursor-pointer">
              <span className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
                {s.showInL2Targets ? "Shown" : "Hidden"}
              </span>
              <input
                type="checkbox"
                checked={s.showInL2Targets}
                onChange={(e) => toggle(s.id, e.target.checked)}
                disabled={busy}
                className="w-[18px] h-[18px] cursor-pointer"
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
