"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshBar } from "@/components/hiring/RefreshBar";
import { formatHiringDateTime } from "@/lib/hiring/core";
import { ERROR_STREAK_LIMIT } from "@/lib/hiring/automation-types";

type Recipe = {
  id: string; name: string; description: string | null; isActive: boolean;
  trigger: { type: string; params?: Record<string, unknown> };
  actions: { type: string; params?: Record<string, unknown> }[];
  lastFiredAt: string | null; fireCount: number; errorStreak: number;
  pauseReason: string | null; ownerName: string | null; runCount: number;
};
type Starter = {
  name: string; description: string;
  trigger: { type: string; params?: Record<string, unknown> };
  actions: { type: string; params?: Record<string, unknown> }[];
};
type Run = {
  id: string; automationName: string; status: string; error: string | null;
  durationMs: number | null; ranAt: string;
};
type DryRun = {
  kind: "event" | "time";
  message?: string;
  total?: number;
  truncated?: boolean;
  matches: { id: string; name: string; jobTitle: string; stageName: string | null }[];
};

const primaryBtn =
  "h-9 px-md rounded-lg bg-primary text-on-primary text-label-sm font-semibold hover:bg-primary-container transition disabled:opacity-60";
const btn =
  "h-9 px-md rounded-lg border border-outline-variant text-label-sm text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";

const TRIGGER_WORDS: Record<string, string> = {
  stage_entered: "when someone enters a stage",
  score_threshold: "when a score passes a threshold",
  time_in_stage: "when someone has sat in a stage too long",
  offer_sent: "when an offer goes out",
  no_activity: "when nobody has been in touch for a while",
  application_created: "when an application arrives",
};

const ACTION_WORDS: Record<string, string> = {
  move_stage: "move them to a stage",
  assign_owner: "assign an owner",
  send_whatsapp_template: "send a WhatsApp template",
  send_email_template: "send an email",
  create_task: "schedule a follow-up and tell the owner",
  notify_user: "notify someone",
  add_tag: "add a tag",
  schedule_followup: "schedule a follow-up",
  add_to_talent_pool: "add them to the talent pool",
};

function describe(r: { trigger: { type: string }; actions: { type: string }[] }): string {
  const t = TRIGGER_WORDS[r.trigger.type] ?? r.trigger.type;
  const a = r.actions.map((x) => ACTION_WORDS[x.type] ?? x.type).join(", then ");
  return `${t[0]!.toUpperCase()}${t.slice(1)} → ${a}.`;
}

export function AutomationsClient({
  automations,
  runs,
  starters,
  loadedAt,
}: {
  automations: Recipe[];
  runs: Run[];
  starters: Starter[];
  loadedAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<{ name: string; result: DryRun } | null>(null);

  async function call(label: string, url: string, body?: unknown, method = "POST") {
    setBusy(label);
    setError(null);
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    setBusy(null);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "That didn't work.");
      return null;
    }
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const unusedStarters = starters.filter((s) => !automations.some((a) => a.name === s.name));

  return (
    <div className="space-y-lg">
      {error && (
        <div role="alert" className="rounded-lg border border-error bg-error-container px-md py-sm text-body-md text-on-error-container">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-md">
        <p className="text-body-md text-on-surface-variant max-w-prose">
          Recipes advance a stage, notify a recruiter or nudge a stalled req without you. They never
          reject anyone — that stays a human decision. A recipe that fails{" "}
          {ERROR_STREAK_LIMIT} times in a row switches itself off and tells its owner.
        </p>
        <RefreshBar loadedAt={loadedAt} label={`${automations.filter((a) => a.isActive).length} active`} />
      </div>

      {dryRun && (
        <section className="rounded-xl border border-outline-variant bg-primary-fixed/30 p-lg">
          <div className="flex items-start justify-between gap-md mb-sm">
            <h3 className="text-h3 text-on-surface">Dry run — {dryRun.name}</h3>
            <button type="button" className={btn} onClick={() => setDryRun(null)}>
              Close
            </button>
          </div>
          {dryRun.result.kind === "event" ? (
            <p className="text-body-md text-on-surface-variant">{dryRun.result.message}</p>
          ) : dryRun.result.matches.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">
              Nobody matches right now. Switching this on would do nothing today.
            </p>
          ) : (
            <>
              <p className="text-body-md text-on-surface mb-sm">
                {dryRun.result.total} application{dryRun.result.total === 1 ? "" : "s"} would be
                acted on{dryRun.result.truncated ? `, showing the first ${dryRun.result.matches.length}` : ""}.
              </p>
              <ul className="space-y-xs text-body-sm text-on-surface-variant max-h-64 overflow-y-auto">
                {dryRun.result.matches.map((m) => (
                  <li key={m.id}>
                    {m.name} · {m.jobTitle}
                    {m.stageName ? ` · ${m.stageName}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="space-y-sm">
        <h2 className="text-h2 text-on-surface">Your recipes</h2>
        {automations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest p-xl text-center">
            <div className="text-body-lg text-on-surface mb-xs">No recipes yet</div>
            <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">
              Start from one of the templates below. They are created switched OFF, so nothing acts
              on a real candidate until you dry-run it and turn it on.
            </p>
          </div>
        ) : (
          <ul className="space-y-sm">
            {automations.map((a) => (
              <li key={a.id} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
                <div className="flex flex-wrap items-start justify-between gap-md">
                  <div className="min-w-0">
                    <div className="flex items-center gap-sm">
                      <span className="text-body-lg font-semibold text-on-surface">{a.name}</span>
                      <span
                        className={
                          "inline-flex items-center h-6 px-sm rounded-full text-label-sm " +
                          (a.isActive
                            ? "bg-primary text-on-primary"
                            : a.pauseReason
                              ? "bg-error-container text-on-error-container"
                              : "bg-surface-container text-on-surface-variant")
                        }
                      >
                        {a.isActive ? "On" : a.pauseReason ? "Auto-paused" : "Off"}
                      </span>
                    </div>
                    <p className="text-body-sm text-on-surface-variant mt-xs">{describe(a)}</p>
                    {a.description && (
                      <p className="text-caption text-on-surface-variant mt-xs">{a.description}</p>
                    )}
                    <div className="text-caption text-on-surface-variant mt-xs">
                      Fired {a.fireCount} time{a.fireCount === 1 ? "" : "s"}
                      {a.lastFiredAt ? ` · last ${formatHiringDateTime(a.lastFiredAt)}` : ""}
                      {a.runCount > 0 ? ` · ${a.runCount} runs logged` : ""}
                      {a.ownerName ? ` · ${a.ownerName}` : ""}
                    </div>
                    {a.pauseReason && (
                      <p className="text-body-sm text-error mt-xs">{a.pauseReason}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-xs">
                    <button
                      type="button"
                      className={btn}
                      disabled={busy !== null}
                      onClick={async () => {
                        const r = await call(`dry-${a.id}`, "/api/hiring/automations/dry-run", {
                          trigger: a.trigger,
                        });
                        if (r) setDryRun({ name: a.name, result: r as unknown as DryRun });
                      }}
                    >
                      {busy === `dry-${a.id}` ? "Checking…" : "Dry run"}
                    </button>
                    <button
                      type="button"
                      className={a.isActive ? btn : primaryBtn}
                      disabled={busy !== null}
                      onClick={async () => {
                        const ok = await call(
                          `t-${a.id}`,
                          `/api/hiring/automations/${a.id}`,
                          { isActive: !a.isActive },
                          "PATCH",
                        );
                        if (ok) router.refresh();
                      }}
                    >
                      {a.isActive ? "Switch off" : "Switch on"}
                    </button>
                    <button
                      type="button"
                      className={btn}
                      disabled={busy !== null}
                      onClick={async () => {
                        const ok = await call(`d-${a.id}`, `/api/hiring/automations/${a.id}`, undefined, "DELETE");
                        if (ok) router.refresh();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {unusedStarters.length > 0 && (
        <section className="space-y-sm">
          <h2 className="text-h2 text-on-surface">Starter recipes</h2>
          <p className="text-body-sm text-on-surface-variant">
            Created switched off. Dry-run one before you turn it on.
          </p>
          <ul className="grid gap-md sm:grid-cols-2">
            {unusedStarters.map((s) => (
              <li key={s.name} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-md">
                <div className="text-body-lg font-semibold text-on-surface">{s.name}</div>
                <p className="text-body-sm text-on-surface-variant mt-xs">{s.description}</p>
                <p className="text-caption text-on-surface-variant mt-xs">{describe(s)}</p>
                <button
                  type="button"
                  className={primaryBtn + " mt-sm"}
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await call(`add-${s.name}`, "/api/hiring/automations", {
                      name: s.name,
                      description: s.description,
                      trigger: s.trigger,
                      actions: s.actions,
                      isActive: false,
                    });
                    if (ok) router.refresh();
                  }}
                >
                  {busy === `add-${s.name}` ? "Adding…" : "Create it (off)"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-sm">
        <h2 className="text-h2 text-on-surface">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            Nothing has run yet. Every firing is logged here, successes and failures alike.
          </p>
        ) : (
          <div className="rounded-xl border border-outline-variant bg-surface-container-lowest overflow-x-auto">
            <table className="w-full text-body-md">
              <thead className="text-left border-b border-outline-variant bg-surface-container-low">
                <tr className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                  <th className="px-lg py-sm">When</th>
                  <th className="px-md py-sm">Recipe</th>
                  <th className="px-md py-sm">Result</th>
                  <th className="px-md py-sm">Detail</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant last:border-0">
                    <td className="px-lg py-sm text-on-surface-variant whitespace-nowrap tabular-nums">
                      {formatHiringDateTime(r.ranAt)}
                    </td>
                    <td className="px-md py-sm text-on-surface">{r.automationName}</td>
                    <td className="px-md py-sm">
                      <span className={r.status === "error" ? "text-error" : "text-on-surface-variant"}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-md py-sm text-caption text-on-surface-variant">
                      {r.error ?? `${r.durationMs ?? 0} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
