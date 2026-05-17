"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Cell = { target: number; actual: number; partyNames: string[] };
type Bde = { userId: string; displayName: string };
type Service = { id: string; name: string };

export function TargetsMatrix({
  year,
  month,
  bdes,
  services,
  cells,
}: {
  year: number;
  month: number;
  bdes: Bde[];
  services: Service[];
  cells: Record<string, Cell>;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const b of bdes) {
      for (const s of services) {
        const key = `${b.userId}|${s.id}`;
        init[key] = cells[key]?.target ?? 0;
      }
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = useMemo(() => {
    for (const b of bdes) {
      for (const s of services) {
        const key = `${b.userId}|${s.id}`;
        if ((drafts[key] ?? 0) !== (cells[key]?.target ?? 0)) return true;
      }
    }
    return false;
  }, [drafts, cells, bdes, services]);

  async function saveAll() {
    setBusy(true);
    setError(null);
    // Matrix columns are now ServiceGroups (the metric helper returns
    // groups in the existing `services` field for backwards compat);
    // each id is a groupId so the save API stores a group target.
    const updates: Array<{ userId: string; groupId: string; target: number }> = [];
    for (const b of bdes) {
      for (const s of services) {
        const key = `${b.userId}|${s.id}`;
        if ((drafts[key] ?? 0) !== (cells[key]?.target ?? 0)) {
          updates.push({ userId: b.userId, groupId: s.id, target: drafts[key] ?? 0 });
        }
      }
    }
    if (updates.length === 0) {
      setBusy(false);
      return;
    }
    const res = await fetch("/api/marketing/lead-pulse/targets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ year, month, updates }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError((data as { error?: string }).error ?? "save_failed");
      return;
    }
    setSavedAt(Date.now());
    router.refresh();
  }

  // Row & column subtotals
  function rowTotals(bde: Bde) {
    let target = 0;
    let actual = 0;
    for (const s of services) {
      const key = `${bde.userId}|${s.id}`;
      target += drafts[key] ?? 0;
      actual += cells[key]?.actual ?? 0;
    }
    return { target, actual };
  }
  function colTotals(svc: Service) {
    let target = 0;
    let actual = 0;
    for (const b of bdes) {
      const key = `${b.userId}|${svc.id}`;
      target += drafts[key] ?? 0;
      actual += cells[key]?.actual ?? 0;
    }
    return { target, actual };
  }

  return (
    <div className="space-y-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
          Each cell shows <span className="font-mono">target / actual</span>. Target is
          editable inline; actual is the count of candidates (
          <span className="font-mono">assignedL2BdeId</span> = BDE) with the service in
          their party-services AND a Revenue transaction recorded in this month.
        </p>
        <div className="flex items-center gap-[12px]">
          {savedAt && !dirty && !error && (
            <span className="text-[11px]" style={{ color: "var(--lp-cyan)" }}>
              ✓ saved
            </span>
          )}
          {error && (
            <span className="text-[11px]" style={{ color: "var(--lp-error)" }}>
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={saveAll}
            disabled={!dirty || busy}
            className="h-[36px] px-[14px] rounded-[8px] text-[13px] font-semibold"
            style={{
              backgroundColor: "var(--lp-primary)",
              color: "var(--lp-on-primary)",
              opacity: !dirty || busy ? 0.5 : 1,
            }}
          >
            {busy ? "Saving…" : "Save all"}
          </button>
        </div>
      </div>

      <div
        className="rounded-[12px] border overflow-x-auto"
        style={{
          backgroundColor: "var(--lp-surface-container)",
          borderColor: "var(--lp-outline-variant)",
        }}
      >
        <table className="w-full text-[12px] tabular-nums" style={{ minWidth: 200 + services.length * 110 + 100 }}>
          <thead>
            <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
              <th
                className="sticky left-0 z-[2] px-[12px] py-[8px] text-left text-[11px] uppercase tracking-[0.05em]"
                style={{
                  backgroundColor: "var(--lp-surface-container-low)",
                  color: "var(--lp-on-surface-variant)",
                  width: 200,
                }}
              >
                L2 BDE
              </th>
              {services.map((s) => (
                <th
                  key={s.id}
                  className="px-[6px] py-[8px] text-center text-[11px] uppercase tracking-[0.03em] border-l"
                  style={{
                    color: "var(--lp-on-surface-variant)",
                    borderColor: "var(--lp-outline-variant)",
                    minWidth: 110,
                  }}
                  title={s.name}
                >
                  {s.name}
                </th>
              ))}
              <th
                className="px-[8px] py-[8px] text-right text-[11px] uppercase tracking-[0.05em] border-l"
                style={{ color: "var(--lp-primary)", borderColor: "var(--lp-outline-variant)" }}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {bdes.map((b) => {
              const totals = rowTotals(b);
              return (
                <tr
                  key={b.userId}
                  className="border-t"
                  style={{ borderColor: "var(--lp-outline-variant)" }}
                >
                  <td
                    className="sticky left-0 px-[12px] py-[6px] font-semibold"
                    style={{ backgroundColor: "var(--lp-surface-container)", color: "var(--lp-on-surface)" }}
                  >
                    {b.displayName}
                  </td>
                  {services.map((s) => {
                    const key = `${b.userId}|${s.id}`;
                    const cell = cells[key] ?? { target: 0, actual: 0, partyNames: [] };
                    const target = drafts[key] ?? 0;
                    const hit = cell.actual >= target && target > 0;
                    return (
                      <td
                        key={s.id}
                        className="px-[6px] py-[6px] border-l"
                        style={{ borderColor: "var(--lp-outline-variant)" }}
                        title={
                          cell.partyNames.length > 0
                            ? `Closed: ${cell.partyNames.join(", ")}`
                            : ""
                        }
                      >
                        <div className="flex items-center justify-center gap-[4px]">
                          <input
                            type="number"
                            min={0}
                            value={target}
                            onChange={(e) =>
                              setDrafts((d) => ({
                                ...d,
                                [key]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            className="w-[44px] h-[26px] text-right rounded text-[12px] tabular-nums"
                            style={{ border: "1px solid var(--lp-outline-variant)" }}
                          />
                          <span style={{ color: "var(--lp-on-surface-variant)" }}>/</span>
                          <span
                            className="w-[28px] text-right font-mono"
                            style={{
                              color: hit ? "var(--lp-cyan)" : "var(--lp-on-surface)",
                              fontWeight: hit ? 700 : 500,
                            }}
                          >
                            {cell.actual}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td
                    className="px-[8px] py-[6px] text-right border-l font-semibold"
                    style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-primary)" }}
                  >
                    {totals.target} / {totals.actual}
                  </td>
                </tr>
              );
            })}
            <tr
              className="border-t"
              style={{
                borderColor: "var(--lp-outline-variant)",
                backgroundColor: "var(--lp-surface-container-low)",
              }}
            >
              <td
                className="sticky left-0 px-[12px] py-[8px] font-semibold uppercase text-[11px]"
                style={{
                  backgroundColor: "var(--lp-surface-container-low)",
                  color: "var(--lp-on-surface-variant)",
                }}
              >
                Totals
              </td>
              {services.map((s) => {
                const t = colTotals(s);
                return (
                  <td
                    key={s.id}
                    className="px-[6px] py-[8px] text-center border-l"
                    style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-on-surface-variant)" }}
                  >
                    {t.target} / {t.actual}
                  </td>
                );
              })}
              <td
                className="px-[8px] py-[8px] text-right border-l font-bold"
                style={{ borderColor: "var(--lp-outline-variant)", color: "var(--lp-primary)" }}
              >
                {bdes.reduce((a, b) => a + rowTotals(b).target, 0)} /{" "}
                {bdes.reduce((a, b) => a + rowTotals(b).actual, 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
