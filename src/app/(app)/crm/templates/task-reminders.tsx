"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CHANNEL_LABELS,
  TASK_REMINDER_CHANNELS,
  DEFAULT_COOLDOWN_HOURS,
  type TaskReminderChannel,
  type TaskReminderConfig,
} from "@/lib/crm-task-reminders";

/**
 * The defaults behind task auto-reminders: what a candidate is sent when a
 * consultant lets a task go past its due date.
 *
 * Two decisions on this screen are easy to get wrong silently, so both are
 * called out rather than left to be discovered in a delivery report.
 *
 * A template that is not APPROVED cannot be sent. It is still offered here,
 * because the status shown is a CACHE — approvals only arrive on their own while
 * the WABA subscription has `message_template_status_update` selected, and
 * otherwise land when somebody presses "Sync from Meta". Hiding a PENDING
 * template would hide one Meta approved days ago. So it is offered with the
 * status stated, and a Sync link beside it.
 *
 * A MARKETING template is the subtler trap. It sends fine, then gets silently
 * dropped for any candidate over Meta's per-user marketing frequency cap
 * (error 131049) — a reminder that never arrives while the record says "sent",
 * which defeats the entire purpose of a safety net.
 */

type WaTpl = {
  key: string;
  name: string;
  language: string;
  status: string;
  category: string;
  body: string | null;
};
type EmailTpl = { id: string; name: string; subject: string | null; body: string };
type MergeField = { token: string; label: string; sample: string };

type Payload = {
  config: TaskReminderConfig;
  waTemplates: WaTpl[];
  catalogueRead: boolean;
  emailTemplates: EmailTpl[];
  taskTypes: string[];
  mergeFields: MergeField[];
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const inputCls =
  "w-full px-md h-9 rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
const primaryBtn =
  "inline-flex items-center justify-center gap-xs px-lg rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 disabled:opacity-50 transition";

/** The distinct `{{n}}` slots in a template body, ascending. */
function slotsIn(body: string | null): number[] {
  if (!body) return [];
  const found = new Set<number>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

export function TaskRemindersCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState<TaskReminderConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const r = await fetch("/api/crm/task-reminders/settings").catch(() => null);
    if (!r) {
      setLoadError("Couldn’t reach the server.");
      return;
    }
    if (!r.ok) {
      // Said out loud rather than swallowed. This card is the ONLY way to turn
      // the feature on, so a silent failure here looks identical to the feature
      // not existing — and leaves an admin with nothing to act on.
      setLoadError(
        r.status === 403
          ? "You don’t have permission to manage templates, so these settings are hidden."
          : `Couldn’t load these settings (HTTP ${r.status}).`,
      );
      return;
    }
    const d: Payload = await r.json();
    setData(d);
    setForm(d.config);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chosenWa = useMemo(
    () => data?.waTemplates.find((t) => t.key === form?.waTemplate) ?? null,
    [data, form?.waTemplate],
  );
  const waSlots = useMemo(() => slotsIn(chosenWa?.body ?? null), [chosenWa]);

  // Never render nothing. An invisible card is indistinguishable from a missing
  // feature, and this is where the feature is switched on.
  if (!data || !form) {
    return (
      <div className={card + " p-lg"}>
        <h3 className="text-h3 text-on-surface flex items-center gap-xs">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }} aria-hidden>
            shield
          </span>
          Task auto-reminders
        </h3>
        <p className="mt-xs text-body-sm text-on-surface-variant">
          {loadError ?? "Loading…"}
        </p>
        {loadError && (
          <button
            type="button"
            onClick={() => void load()}
            className="mt-sm h-9 px-lg rounded-lg border border-outline-variant text-label-sm font-semibold text-on-surface-variant hover:bg-surface-container-low transition"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(data.config);

  function patch(next: Partial<TaskReminderConfig>) {
    setNote(null);
    setForm((f) => (f ? { ...f, ...next } : f));
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setNote(null);
    const r = await fetch("/api/crm/task-reminders/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      setNote("Couldn’t save. Please try again.");
      return;
    }
    const d = await r.json();
    setForm(d.config);
    setData((prev) => (prev ? { ...prev, config: d.config } : prev));
    setNote("Saved.");
  }

  return (
    <div className={card + " p-lg space-y-md"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-md text-left"
      >
        <div className="min-w-0">
          <h3 className="text-h3 text-on-surface flex items-center gap-xs">
            <span className="material-symbols-outlined text-primary" style={{ fontSize: 20 }} aria-hidden>
              shield
            </span>
            Task auto-reminders
          </h3>
          <p className="text-body-sm text-on-surface-variant max-w-3xl">
            When a consultant leaves a task past its due date, the candidate is messaged the next morning
            anyway. Completing the task cancels it. These are the defaults every consultant’s tasks start
            from.
          </p>
        </div>
        <span className="flex items-center gap-sm flex-shrink-0">
          {dirty && (
            <span className="px-sm h-7 inline-flex items-center rounded-full text-label-sm font-semibold border border-error/40 bg-error/5 text-error">
              Unsaved
            </span>
          )}
          {/* Reads the SAVED config, never the form. Reflecting unsaved state
              here made ticking the box flip the pill to "On", so the card looked
              saved when nothing had been persisted — and the feature stayed off
              with no sign of it. */}
          <span
            className={
              "px-sm h-7 inline-flex items-center rounded-full text-label-sm font-semibold border " +
              (data.config.enabled
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-surface-container-high text-on-surface-variant border-outline-variant")
            }
          >
            {data.config.enabled ? "On" : "Off"}
          </span>
          <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: 20 }} aria-hidden>
            {open ? "expand_less" : "expand_more"}
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-lg pt-md border-t border-outline-variant">
          <label className="flex items-start gap-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => patch({ enabled: e.target.checked })}
              className="mt-[3px] h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/30"
            />
            <span>
              <span className="text-body-md font-medium text-on-surface">Send automated reminders</span>
              <span className="block text-label-sm text-on-surface-variant">
                Turning this off stops sending immediately. Reminders already armed are kept, not deleted,
                so switching back on does not lose them.
              </span>
            </span>
          </label>

          {/* ── WhatsApp ─────────────────────────────────────────────── */}
          <section className="space-y-sm">
            <h4 className="text-label-md font-semibold text-on-surface">Default WhatsApp template</h4>
            <select
              value={form.waTemplate ?? ""}
              onChange={(e) => patch({ waTemplate: e.target.value || null })}
              className={inputCls}
            >
              <option value="">No WhatsApp reminder</option>
              {data.waTemplates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name} ({t.language}) — {t.status}
                  {t.category ? ` · ${t.category}` : ""}
                </option>
              ))}
            </select>

            {chosenWa && chosenWa.status !== "APPROVED" && (
              <Warning tone="warn">
                DesGro has this template as <b>{chosenWa.status}</b>, and only an APPROVED template can be
                sent. That status is a cache — if Meta has approved it since, press <b>Sync from Meta</b> on
                the WhatsApp tab. Reminders are armed either way and Meta decides at send time.
              </Warning>
            )}
            {chosenWa && chosenWa.category === "MARKETING" && (
              <Warning tone="error">
                This template is categorised <b>Marketing</b>. Meta applies a per-user marketing frequency
                cap, and a message over it is accepted and then silently dropped (error 131049) — the
                reminder never arrives while the record says it was sent. A reminder about work a candidate
                already has with us belongs in <b>Utility</b>: author one with the candidate’s name and the
                pending item as variables, and switch this over once it is approved.
              </Warning>
            )}
            {chosenWa && !chosenWa.body && (
              <p className="text-label-sm text-on-surface-variant">
                This template’s wording is held at Meta, not here — consultants will see its name rather
                than a preview.
              </p>
            )}

            {waSlots.length > 0 && (
              <div className="space-y-xs pt-xs">
                <p className="text-label-sm text-on-surface-variant">
                  This template has {waSlots.length} variable{waSlots.length > 1 ? "s" : ""}. Say what goes
                  in each.
                </p>
                {waSlots.map((n) => (
                  <div key={n} className="flex items-center gap-sm">
                    <span className="font-mono text-label-sm text-on-surface-variant w-12 flex-shrink-0">
                      {`{{${n}}}`}
                    </span>
                    <select
                      value={form.waVariables[String(n)] ?? ""}
                      onChange={(e) =>
                        patch({ waVariables: { ...form.waVariables, [String(n)]: e.target.value } })
                      }
                      className={inputCls}
                    >
                      <option value="">— choose —</option>
                      {data.mergeFields.map((f) => (
                        <option key={f.token} value={f.token}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Email ────────────────────────────────────────────────── */}
          <section className="space-y-sm">
            <h4 className="text-label-md font-semibold text-on-surface">Default email template</h4>
            <select
              value={form.emailTemplateId ?? ""}
              onChange={(e) => patch({ emailTemplateId: e.target.value || null })}
              className={inputCls}
            >
              <option value="">No email reminder</option>
              {data.emailTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-label-sm text-on-surface-variant">
              Merge fields:{" "}
              {data.mergeFields.map((f, i) => (
                <span key={f.token}>
                  {i > 0 && ", "}
                  <span className="font-mono">{`{${f.token}}`}</span>
                </span>
              ))}
            </p>
          </section>

          {/* ── Policy ───────────────────────────────────────────────── */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-md">
            <div className="space-y-xs">
              <h4 className="text-label-md font-semibold text-on-surface">Ticked by default</h4>
              {TASK_REMINDER_CHANNELS.map((c) => (
                <label key={c} className="flex items-center gap-sm cursor-pointer text-body-md">
                  <input
                    type="checkbox"
                    checked={form.defaultChannels.includes(c)}
                    onChange={(e) =>
                      patch({
                        defaultChannels: e.target.checked
                          ? [...form.defaultChannels, c]
                          : form.defaultChannels.filter((x) => x !== c),
                      })
                    }
                    className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/30"
                  />
                  {CHANNEL_LABELS[c as TaskReminderChannel]}
                </label>
              ))}
              <p className="text-label-sm text-on-surface-variant">
                Consultants can untick either one per task.
              </p>
            </div>

            <div className="space-y-xs">
              <h4 className="text-label-md font-semibold text-on-surface">Cooldown</h4>
              <div className="flex items-center gap-sm">
                <input
                  type="number"
                  min={0}
                  max={168}
                  value={form.cooldownHours}
                  onChange={(e) =>
                    patch({ cooldownHours: Math.max(0, Math.min(168, Number(e.target.value) || 0)) })
                  }
                  className={inputCls + " w-24"}
                />
                <span className="text-body-md text-on-surface-variant">hours</span>
              </div>
              <p className="text-label-sm text-on-surface-variant">
                A candidate is reminded about at most one task in this window — otherwise someone with four
                overdue tasks gets four messages in a morning. Both channels of the <i>same</i> task still
                go out, since that is what the consultant ticked. 0 disables it. Default{" "}
                {DEFAULT_COOLDOWN_HOURS}.
              </p>
            </div>
          </section>

          {/* ── Per-type overrides ───────────────────────────────────── */}
          <section className="space-y-sm">
            <h4 className="text-label-md font-semibold text-on-surface">Per task type</h4>
            <p className="text-label-sm text-on-surface-variant">
              Optional. Leave blank to use the defaults above — which is the right answer while one
              variable-free template says the same thing for every type.
            </p>
            <div className="space-y-sm">
              {data.taskTypes.map((type) => {
                const o = form.overrides[type] ?? {};
                const set = (next: Partial<typeof o>) =>
                  patch({ overrides: { ...form.overrides, [type]: { ...o, ...next } } });
                return (
                  <div key={type} className="grid grid-cols-1 sm:grid-cols-3 gap-sm items-center">
                    <span className="text-body-sm text-on-surface">{type}</span>
                    <select
                      value={o.waTemplate ?? ""}
                      onChange={(e) => set({ waTemplate: e.target.value || null })}
                      className={inputCls}
                    >
                      <option value="">WhatsApp — default</option>
                      {data.waTemplates.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.name} ({t.language})
                        </option>
                      ))}
                    </select>
                    <select
                      value={o.emailTemplateId ?? ""}
                      onChange={(e) => set({ emailTemplateId: e.target.value || null })}
                      className={inputCls}
                    >
                      <option value="">Email — default</option>
                      {data.emailTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex items-center justify-end gap-md pt-md border-t border-outline-variant">
            {note && <span className="text-label-sm text-on-surface-variant">{note}</span>}
            {dirty && !note && (
              <span className="text-label-sm text-error">Nothing here takes effect until you save.</span>
            )}
            <button type="button" onClick={save} disabled={busy || !dirty} className={primaryBtn + " h-9"}>
              {busy ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Warning({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      className={
        "rounded-lg border px-md py-sm text-label-sm flex items-start gap-xs " +
        (tone === "error"
          ? "border-error/30 bg-error/5 text-on-surface"
          : "border-outline-variant bg-surface-container-low text-on-surface-variant")
      }
    >
      <span
        className={"material-symbols-outlined flex-shrink-0 " + (tone === "error" ? "text-error" : "")}
        style={{ fontSize: 16 }}
        aria-hidden
      >
        {tone === "error" ? "warning" : "info"}
      </span>
      <span>{children}</span>
    </div>
  );
}
