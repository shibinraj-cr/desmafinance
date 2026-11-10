"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Person = { name: string; active: boolean; enrolled: number; minimum: number | null };
export type TargetPair = { target: number; pool: number };
type Team = { id: string; name: string; active: boolean };
type PairDraft = { target: string; pool: string };
type TeamDraft = { month: PairDraft; quarter: PairDraft };

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const toPair = (p: TargetPair | null | undefined): PairDraft =>
  p ? { target: String(p.target), pool: String(p.pool) } : { target: "", pool: "" };

/** A target + pool draft as saved: null when both are blank, or why it can't be saved. */
function readPair(d: PairDraft): { value: TargetPair | null; error: string | null } {
  const t = d.target.trim();
  const p = d.pool.replace(/[,₹\s]/g, "");
  if (t === "" && p === "") return { value: null, error: null };
  if (t === "" || p === "") return { value: null, error: "Set both a target and a pool, or leave both blank." };
  const target = Number(t);
  const pool = Number(p);
  if (!Number.isInteger(target) || target < 1) return { value: null, error: "The target must be a whole number of 1 or more." };
  if (!Number.isInteger(pool) || pool < 0) return { value: null, error: "The pool must be a whole number of rupees." };
  return { value: { target, pool }, error: null };
}

export function TeamsSheet({
  year,
  month,
  monthName,
  prevName,
  quarterLabel,
  readOnly,
  teams: initialTeams,
  people,
  members: initialMembers,
  targets: initialTargets,
  progress,
  prev,
}: {
  year: number;
  month: number;
  monthName: string;
  prevName: string;
  quarterLabel: string;
  readOnly: boolean;
  teams: Team[];
  people: Record<string, Person>;
  members: Record<string, string[]>;
  targets: Record<string, { month: TargetPair | null; quarter: TargetPair | null }>;
  progress: Record<string, { month: number | null; quarter: number | null }>;
  prev: { members: Record<string, string[]>; targets: Record<string, TargetPair> };
}) {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [members, setMembers] = useState<Record<string, string[]>>(initialMembers);
  const [drafts, setDrafts] = useState<Record<string, TeamDraft>>(() =>
    Object.fromEntries(
      initialTeams.map((t) => [
        t.id,
        { month: toPair(initialTargets[t.id]?.month), quarter: toPair(initialTargets[t.id]?.quarter) },
      ]),
    ),
  );
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const draftOf = (id: string): TeamDraft => drafts[id] ?? { month: toPair(null), quarter: toPair(null) };
  const hasTargets = (id: string) => {
    const d = draftOf(id);
    return [d.month, d.quarter].some((p) => p.target.trim() !== "" || p.pool.trim() !== "");
  };
  // A retired team still shows while it holds members or targets this month.
  const shown = teams.filter((t) => t.active || (members[t.id]?.length ?? 0) > 0 || hasTargets(t.id));
  const retired = teams.filter((t) => !shown.includes(t));
  const assigned = new Set(shown.flatMap((t) => members[t.id] ?? []));
  const unassigned = Object.entries(people)
    .filter(([id, p]) => p.active && !assigned.has(id))
    .sort((a, b) => a[1].name.localeCompare(b[1].name));

  const payload = (ids: Team[], m: Record<string, string[]>, read: (id: string) => TeamDraft) =>
    ids.map((t) => ({
      teamId: t.id,
      userIds: [...(m[t.id] ?? [])].sort(),
      month: readPair(read(t.id).month).value,
      quarter: readPair(read(t.id).quarter).value,
    }));
  const errors = Object.fromEntries(
    shown.map((t) => [t.id, readPair(draftOf(t.id).month).error ?? readPair(draftOf(t.id).quarter).error]),
  );
  const invalid = shown.some((t) => errors[t.id]);
  const initialRead = (id: string): TeamDraft => ({
    month: toPair(initialTargets[id]?.month),
    quarter: toPair(initialTargets[id]?.quarter),
  });
  const dirty =
    JSON.stringify(payload(shown, members, draftOf)) !== JSON.stringify(payload(shown, initialMembers, initialRead));

  function setPair(teamId: string, period: keyof TeamDraft, half: keyof PairDraft, value: string) {
    setDrafts((d) => {
      const cur = d[teamId] ?? { month: toPair(null), quarter: toPair(null) };
      return { ...d, [teamId]: { ...cur, [period]: { ...cur[period], [half]: value } } };
    });
  }
  function addMember(teamId: string, userId: string) {
    if (!userId) return;
    setMembers((m) => ({ ...m, [teamId]: [...(m[teamId] ?? []), userId] }));
  }
  function removeMember(teamId: string, userId: string) {
    setMembers((m) => ({ ...m, [teamId]: (m[teamId] ?? []).filter((id) => id !== userId) }));
  }

  const canCopy =
    !readOnly && (Object.keys(prev.members).length > 0 || Object.keys(prev.targets).length > 0);
  function copyPrevious() {
    const active = new Set(teams.filter((t) => t.active).map((t) => t.id));
    const taken = new Set(assigned);
    let moved = 0;
    const nextMembers = { ...members };
    for (const [teamId, ids] of Object.entries(prev.members)) {
      if (!active.has(teamId)) continue;
      for (const id of ids) {
        if (taken.has(id) || !people[id]?.active) continue;
        nextMembers[teamId] = [...(nextMembers[teamId] ?? []), id];
        taken.add(id);
        moved++;
      }
    }
    const nextDrafts = { ...drafts };
    let filled = 0;
    for (const [teamId, p] of Object.entries(prev.targets)) {
      if (!active.has(teamId)) continue;
      const cur = nextDrafts[teamId] ?? { month: toPair(null), quarter: toPair(null) };
      if (cur.month.target.trim() === "" && cur.month.pool.trim() === "") {
        nextDrafts[teamId] = { ...cur, month: toPair(p) };
        filled++;
      }
    }
    setMembers(nextMembers);
    setDrafts(nextDrafts);
    setError(null);
    setNotice(
      moved || filled
        ? `Copied ${moved} BDE${moved === 1 ? "" : "s"} and ${filled} monthly target${filled === 1 ? "" : "s"} from ${prevName}. Check them, then Save all.`
        : `Nothing new to copy from ${prevName}.`,
    );
  }

  async function call(method: "POST" | "PATCH" | "PUT", body: unknown) {
    const res = await fetch("/api/marketing/lead-pulse/incentive/teams", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; team?: Team };
    if (!res.ok) throw new Error(data.message ?? data.error ?? "Could not save.");
    return data;
  }

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const createTeam = () =>
    run(async () => {
      const { team } = await call("POST", { name: newName.trim() });
      if (team) {
        setTeams((ts) => [...ts, team].sort((a, b) => a.name.localeCompare(b.name)));
        setDrafts((d) => ({ ...d, [team.id]: { month: toPair(null), quarter: toPair(null) } }));
      }
      setNewName("");
      return `Created ${team?.name ?? "the team"}.`;
    });

  const updateTeam = (id: string, change: { name?: string; active?: boolean }, done: string) =>
    run(async () => {
      const { team } = await call("PATCH", { id, ...change });
      if (team) setTeams((ts) => ts.map((t) => (t.id === id ? team : t)).sort((a, b) => a.name.localeCompare(b.name)));
      setRenaming(null);
      return done;
    });

  const saveAll = () =>
    run(async () => {
      await call("PUT", { year, month, teams: payload(shown, members, draftOf) });
      router.refresh();
      return "Saved.";
    });

  const muted = { color: "var(--lp-on-surface-variant)" };
  const card = { backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" };
  const inputStyle = { border: "1px solid var(--lp-outline-variant)" };
  const outlineBtn = "h-[36px] px-[14px] rounded-[8px] border text-[13px] font-semibold";

  return (
    <div className="space-y-[16px]">
      <div className="flex flex-wrap items-center justify-between gap-[12px] rounded-[12px] p-[12px] border" style={card}>
        <div className="flex flex-wrap items-center gap-[8px]">
          <button
            type="button"
            onClick={copyPrevious}
            disabled={!canCopy || busy}
            className={outlineBtn}
            style={{ borderColor: "var(--lp-outline-variant)", opacity: canCopy ? 1 : 0.5 }}
          >
            Copy teams from {prevName}
          </button>
          {!readOnly && (
            <form
              className="flex items-center gap-[6px]"
              onSubmit={(e) => {
                e.preventDefault();
                if (newName.trim()) createTeam();
              }}
            >
              <label htmlFor="new-team" className="sr-only">
                New team name
              </label>
              <input
                id="new-team"
                value={newName}
                maxLength={60}
                placeholder="New team name"
                onChange={(e) => setNewName(e.target.value)}
                className="h-[36px] w-[180px] px-[10px] rounded-[8px] text-[13px]"
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={!newName.trim() || busy}
                className={outlineBtn}
                style={{ borderColor: "var(--lp-outline-variant)", opacity: newName.trim() ? 1 : 0.5 }}
              >
                New team
              </button>
            </form>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-[12px]">
          <span role="status" className="text-[12px]" style={{ color: error ? "var(--lp-error)" : "var(--lp-cyan)" }}>
            {error ?? notice ?? ""}
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={saveAll}
              disabled={!dirty || invalid || busy}
              className="h-[36px] px-[16px] rounded-[8px] text-[13px] font-bold"
              style={{
                backgroundColor: "var(--lp-primary)",
                color: "var(--lp-on-primary)",
                opacity: !dirty || invalid || busy ? 0.5 : 1,
              }}
            >
              {busy ? "Saving…" : "Save all"}
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-[12px] p-[24px] border text-center text-[13px]" style={{ ...card, ...muted }}>
          No teams yet. Name one above and click New team, then add L2 BDEs to it.
        </div>
      ) : (
        <div className="grid gap-[16px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 520px), 1fr))" }}>
          {shown.map((t) => {
            const ids = members[t.id] ?? [];
            const d = draftOf(t.id);
            const monthPair = readPair(d.month).value;
            const quarterPair = readPair(d.quarter).value;
            const prog = progress[t.id];
            const below = ids.filter((id) => {
              const p = people[id];
              return p && !(p.enrolled > 0 && p.enrolled >= (p.minimum ?? 0));
            });
            const canRetire = t.active && ids.length === 0 && !hasTargets(t.id);
            return (
              <section
                key={t.id}
                aria-labelledby={`team-${t.id}`}
                className="flex flex-col gap-[16px] rounded-[12px] p-[20px] border min-w-0"
                style={card}
              >
                <div className="flex flex-wrap items-center justify-between gap-[8px]">
                  {renaming?.id === t.id ? (
                    <form
                      className="flex items-center gap-[6px]"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (renaming.name.trim()) updateTeam(t.id, { name: renaming.name.trim() }, "Renamed.");
                      }}
                    >
                      <label htmlFor={`rename-${t.id}`} className="sr-only">
                        New name for {t.name}
                      </label>
                      <input
                        id={`rename-${t.id}`}
                        value={renaming.name}
                        maxLength={60}
                        autoFocus
                        onChange={(e) => setRenaming({ id: t.id, name: e.target.value })}
                        className="h-[32px] w-[180px] px-[8px] rounded-[6px] text-[14px]"
                        style={inputStyle}
                      />
                      <button type="submit" disabled={busy} className="h-[32px] px-[10px] rounded-[6px] border text-[12px] font-semibold" style={{ borderColor: "var(--lp-outline-variant)" }}>
                        Save name
                      </button>
                      <button type="button" onClick={() => setRenaming(null)} className="h-[32px] px-[10px] text-[12px]" style={muted}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <h2 id={`team-${t.id}`} className="text-[18px] font-bold">
                      {t.name}
                      {!t.active && (
                        <span className="ml-[8px] text-[12px] font-semibold" style={{ color: "var(--lp-orange)" }}>
                          retired
                        </span>
                      )}
                    </h2>
                  )}
                  <div className="flex items-center gap-[10px] text-[12px]" style={muted}>
                    <span>
                      {ids.length} BDE{ids.length === 1 ? "" : "s"}
                    </span>
                    {!readOnly && renaming?.id !== t.id && (
                      <button type="button" onClick={() => setRenaming({ id: t.id, name: t.name })} className="underline">
                        Rename
                      </button>
                    )}
                    {!readOnly && t.active && (
                      <button
                        type="button"
                        disabled={!canRetire || busy}
                        onClick={() => updateTeam(t.id, { active: false }, `Retired ${t.name}.`)}
                        className="underline"
                        style={{ opacity: canRetire ? 1 : 0.5 }}
                        title={canRetire ? "Hide this team from now on; its history stays" : "Remove its BDEs and targets first"}
                      >
                        Retire
                      </button>
                    )}
                  </div>
                </div>

                <ul className="flex flex-wrap items-center gap-[8px]" aria-label={`${t.name} members`}>
                  {ids.map((id) => {
                    const p = people[id];
                    const ok = p ? p.enrolled > 0 && p.enrolled >= (p.minimum ?? 0) : false;
                    return (
                      <li
                        key={id}
                        className="inline-flex items-center gap-[6px] h-[32px] pl-[12px] pr-[4px] rounded-full border text-[13px] font-semibold"
                        style={{ backgroundColor: "var(--lp-surface-container-high)", borderColor: "var(--lp-outline-variant)" }}
                      >
                        {p?.name ?? "Unknown user"}
                        {p && !p.active && <span className="text-[11px] font-normal" style={muted}>(left)</span>}
                        {p && (
                          <span
                            className="text-[11px] font-normal"
                            style={{ color: ok ? "var(--lp-cyan)" : "var(--lp-on-surface-variant)" }}
                            title={p.minimum === null ? "No minimum set on Minimum & slabs" : `Minimum ${p.minimum}`}
                          >
                            {p.enrolled}
                            {p.minimum !== null ? ` of min ${p.minimum}` : " · no min"}
                          </span>
                        )}
                        {!readOnly && (
                          <button
                            type="button"
                            aria-label={`Remove ${p?.name ?? "this BDE"} from ${t.name}`}
                            onClick={() => removeMember(t.id, id)}
                            className="w-[24px] h-[24px] rounded-full"
                            style={muted}
                          >
                            ×
                          </button>
                        )}
                      </li>
                    );
                  })}
                  {!readOnly && unassigned.length > 0 && (
                    <li>
                      <select
                        aria-label={`Add BDE to ${t.name}`}
                        value=""
                        onChange={(e) => addMember(t.id, e.target.value)}
                        className="h-[32px] px-[10px] rounded-full text-[13px] font-semibold"
                        style={{ border: "1px dashed var(--lp-outline-variant)", color: "var(--lp-primary)" }}
                      >
                        <option value="">+ Add BDE</option>
                        {unassigned.map(([id, p]) => (
                          <option key={id} value={id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  )}
                </ul>

                <div className="grid gap-[12px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                  {(
                    [
                      ["month", `Monthly · ${monthName}`, monthPair, prog?.month ?? null, "var(--lp-primary)"],
                      ["quarter", `Quarterly · ${quarterLabel}`, quarterPair, prog?.quarter ?? null, "var(--lp-cyan)"],
                    ] as const
                  ).map(([period, heading, pair, soFar, colour]) => (
                    <div
                      key={period}
                      className="flex flex-col gap-[10px] rounded-[10px] p-[14px] border"
                      style={{ borderColor: "var(--lp-outline-variant)" }}
                    >
                      <span className="text-[11px] font-bold uppercase tracking-[0.06em]" style={muted}>
                        {heading}
                      </span>
                      <div className="grid grid-cols-[auto_1fr] items-center gap-x-[10px] gap-y-[8px] text-[13px]">
                        <label htmlFor={`${t.id}-${period}-t`}>Team target</label>
                        <input
                          id={`${t.id}-${period}-t`}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={d[period].target}
                          disabled={readOnly}
                          onChange={(e) => setPair(t.id, period, "target", e.target.value)}
                          className="w-[72px] h-[32px] px-[8px] text-right rounded-[6px]"
                          style={inputStyle}
                        />
                        <label htmlFor={`${t.id}-${period}-p`}>Pool ₹</label>
                        <input
                          id={`${t.id}-${period}-p`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          value={d[period].pool}
                          disabled={readOnly}
                          onChange={(e) => setPair(t.id, period, "pool", e.target.value)}
                          className="w-[100px] h-[32px] px-[8px] text-right rounded-[6px]"
                          style={inputStyle}
                        />
                      </div>
                      {pair && soFar !== null ? (
                        <>
                          <div
                            className="h-[8px] rounded-full overflow-hidden"
                            style={{ backgroundColor: "var(--lp-surface-container-high)" }}
                            role="progressbar"
                            aria-label={`${t.name} ${period} progress`}
                            aria-valuemin={0}
                            aria-valuemax={pair.target}
                            aria-valuenow={soFar}
                          >
                            <div
                              className="h-full"
                              style={{ width: `${Math.min(100, (soFar / pair.target) * 100)}%`, backgroundColor: colour }}
                            />
                          </div>
                          <span className="text-[12px]" style={muted}>
                            {soFar} of {pair.target} so far
                          </span>
                        </>
                      ) : (
                        <span className="text-[12px]" style={muted}>
                          {pair ? "Progress shows once saved." : "No team incentive for this period."}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {errors[t.id] && (
                  <p className="text-[12px]" style={{ color: "var(--lp-error)" }}>
                    {errors[t.id]}
                  </p>
                )}
                {monthPair && monthPair.pool > 0 && (
                  <p className="text-[12px] leading-[18px]" style={muted}>
                    If the team reaches {monthPair.target} in {monthName}, the {rupees(monthPair.pool)} pool pays about{" "}
                    {rupees(Math.round(monthPair.pool / monthPair.target))} per enrolment to members who reached their
                    minimum.
                    {below.length > 0 &&
                      ` Not sharing yet: ${below.map((id) => people[id]?.name ?? "Unknown user").join(", ")} — their enrolments still count toward ${monthPair.target}.`}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}

      {retired.length > 0 && (
        <section aria-labelledby="retired-h" className="rounded-[12px] p-[16px] border space-y-[8px]" style={card}>
          <h2 id="retired-h" className="text-[13px] font-bold">
            Retired teams
          </h2>
          <ul className="flex flex-wrap gap-[8px]">
            {retired.map((t) => (
              <li key={t.id} className="inline-flex items-center gap-[8px] text-[13px]">
                {t.name}
                {!readOnly && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => updateTeam(t.id, { active: true }, `Restored ${t.name}.`)}
                    className="underline text-[12px]"
                    style={{ color: "var(--lp-primary)" }}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="rounded-[10px] px-[16px] py-[12px] border border-dashed text-[13px] leading-[20px]" style={{ ...muted, borderColor: "var(--lp-outline-variant)" }}>
        Everyone&rsquo;s enrolments count toward the team target; the pool is split, by enrolments, among members who
        reached their own minimum (for the quarter: their three monthly minimums added up). Teams are saved month by
        month, so a BDE who moves team counts for the new team from that month, and a mover&rsquo;s enrolments stay with
        the team they were in. An L2 BDE in no team gets no team incentive. Minimums are set on Minimum &amp; slabs.
      </p>
    </div>
  );
}
