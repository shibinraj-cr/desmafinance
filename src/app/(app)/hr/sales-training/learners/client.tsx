"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/Cards";
import { Bar, btnGhost, btnPrimary, inputCls, Pill } from "@/components/sales-training/ui";

type Candidate = { id: string; name: string; empCode: string; designation: string; department: string; hasLogin: boolean };
type Learner = {
  employeeId: string;
  name: string;
  empCode: string;
  designation: string;
  hasLogin: boolean;
  active: boolean;
  dueDate: string | null;
  enrolledAt: string;
  passed: number;
  total: number;
  avgScore: number | null;
  lastActivity: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

export function LearnersClient({ candidates, learners, canEdit }: { candidates: Candidate[]; learners: Learner[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [due, setDue] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  const depts = useMemo(() => [...new Set(candidates.map((c) => c.department).filter(Boolean))].sort(), [candidates]);
  const shown = candidates.filter((c) => {
    if (dept && c.department !== dept) return false;
    const s = q.trim().toLowerCase();
    return !s || [c.name, c.empCode, c.designation, c.department].some((x) => x.toLowerCase().includes(s));
  });

  async function call(url: string, method: string, body: unknown, ok: string) {
    setMsg(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg({ tone: "err", text: j.error || "Something went wrong." });
      return false;
    }
    setMsg({ tone: "ok", text: ok });
    start(() => router.refresh());
    return true;
  }

  async function enrol() {
    const ok = await call(
      "/api/hr/sales-training/learners",
      "POST",
      { employeeIds: [...picked], dueDate: due || null },
      `${picked.size} enrolled and notified.`,
    );
    if (ok) setPicked(new Set());
  }

  const active = learners.filter((l) => l.active);
  const removed = learners.filter((l) => !l.active);
  const now = today();

  return (
    <div className="space-y-lg">
      {msg && <p className={"text-label-sm font-semibold " + (msg.tone === "ok" ? "text-green-700" : "text-red-700")}>{msg.text}</p>}

      {canEdit && (
        <Section title="Enrol consultants">
          <div className="flex flex-col md:flex-row gap-sm mb-sm">
            <input className={inputCls + " flex-1"} placeholder="Search name, code, designation…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={inputCls} value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {depts.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="max-h-72 overflow-y-auto border border-outline-variant rounded divide-y divide-outline-variant">
            {shown.length === 0 && <p className="p-md text-center text-on-surface-variant text-label-sm">No matching employees.</p>}
            {shown.map((c) => (
              <label key={c.id} className="flex items-center gap-sm px-sm py-xs text-label-sm hover:bg-surface-container cursor-pointer">
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={() => {
                    const next = new Set(picked);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    setPicked(next);
                  }}
                />
                <span className="font-semibold">{c.name}</span>
                <span className="text-on-surface-variant">
                  {c.empCode} · {c.designation || "—"}
                  {c.department ? ` · ${c.department}` : ""}
                </span>
                {!c.hasLogin && <Pill tone="red">no login</Pill>}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-sm mt-sm">
            <button className={btnGhost} onClick={() => setPicked(new Set([...picked, ...shown.map((c) => c.id)]))}>
              Select all shown ({shown.length})
            </button>
            {picked.size > 0 && (
              <button className={btnGhost} onClick={() => setPicked(new Set())}>
                Clear
              </button>
            )}
            <div className="flex-1" />
            <label className="flex items-center gap-xs text-label-sm">
              Complete by
              <input type="date" className={inputCls + " py-xs"} value={due} min={now} onChange={(e) => setDue(e.target.value)} />
            </label>
            <button className={btnPrimary} disabled={pending || picked.size === 0} onClick={enrol}>
              Enrol {picked.size || ""}
            </button>
          </div>
          <p className="text-caption text-on-surface-variant mt-xs">
            Employees marked <b>no login</b> can&apos;t open the training until their user account is linked to their employee record.
          </p>
        </Section>
      )}

      <Section
        title={`Enrolled (${active.length})`}
        action={
          removed.length > 0 ? (
            <label className="flex items-center gap-xs text-label-sm text-on-surface-variant">
              <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} />
              Show {removed.length} removed
            </label>
          ) : undefined
        }
      >
        {active.length === 0 && !showRemoved ? (
          <p className="py-md text-center text-on-surface-variant">Nobody enrolled yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-label-sm">
              <thead className="text-left text-on-surface-variant border-b border-outline-variant">
                <tr>
                  <th className="py-sm pr-md">Consultant</th>
                  <th className="py-sm pr-md min-w-[140px]">Modules passed</th>
                  <th className="py-sm pr-md">Avg best</th>
                  <th className="py-sm pr-md">Complete by</th>
                  <th className="py-sm pr-md">Last activity</th>
                  {canEdit && <th className="py-sm pr-md" />}
                </tr>
              </thead>
              <tbody>
                {[...active, ...(showRemoved ? removed : [])].map((l) => {
                  const overdue = l.active && !!l.dueDate && l.dueDate < now && l.passed < l.total;
                  return (
                    <tr key={l.employeeId} className={"border-b border-outline-variant last:border-0 " + (l.active ? "" : "opacity-60")}>
                      <td className="py-sm pr-md">
                        <Link href={`/hr/sales-training/learners/${l.employeeId}`} className="font-semibold hover:underline">
                          {l.name}
                        </Link>
                        <div className="text-[11px] text-on-surface-variant flex items-center gap-xs">
                          {l.empCode} · {l.designation || "—"}
                          {!l.hasLogin && <Pill tone="red">no login</Pill>}
                          {!l.active && <Pill tone="grey">removed</Pill>}
                        </div>
                      </td>
                      <td className="py-sm pr-md">
                        <div className="flex items-center gap-xs">
                          <Bar pct={l.total ? (l.passed * 100) / l.total : 0} tone={l.total > 0 && l.passed === l.total ? "green" : "primary"} />
                          <span className="whitespace-nowrap">
                            {l.passed}/{l.total}
                          </span>
                        </div>
                      </td>
                      <td className="py-sm pr-md font-semibold">{l.avgScore != null ? `${l.avgScore}%` : "—"}</td>
                      <td className="py-sm pr-md">
                        {canEdit && l.active ? (
                          <input
                            type="date"
                            className={inputCls + " py-[2px] text-label-sm " + (overdue ? "border-red-600 text-red-700" : "")}
                            defaultValue={l.dueDate ?? ""}
                            onBlur={(e) => {
                              const v = e.target.value || null;
                              if (v !== l.dueDate) call(`/api/hr/sales-training/learners/${l.employeeId}`, "PATCH", { dueDate: v }, "Due date updated.");
                            }}
                          />
                        ) : (
                          <span className={overdue ? "text-red-700 font-bold" : ""}>{l.dueDate ?? "—"}</span>
                        )}
                      </td>
                      <td className="py-sm pr-md text-on-surface-variant">
                        {l.lastActivity ? new Date(l.lastActivity).toLocaleDateString("en-IN") : "never"}
                      </td>
                      {canEdit && (
                        <td className="py-sm pr-md text-right">
                          <button
                            className="text-label-sm text-on-surface-variant hover:underline"
                            disabled={pending}
                            onClick={() =>
                              call(
                                `/api/hr/sales-training/learners/${l.employeeId}`,
                                "PATCH",
                                { active: !l.active },
                                l.active ? `${l.name} removed (scores kept).` : `${l.name} restored.`,
                              )
                            }
                          >
                            {l.active ? "Remove" : "Restore"}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
