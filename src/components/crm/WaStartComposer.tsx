"use client";

import { useMemo, useState } from "react";
import { fillPreview, renderedTemplateText, type WaTemplateOpt } from "./WaComposer";

/**
 * Starts a WhatsApp thread that doesn't exist yet — the lead has never
 * messaged the business number, so there is no session and no reply box, only
 * a template. Deliberately a separate component from `WaComposer` rather than
 * a mode of it: that composer's whole shape assumes a `conversationId` already
 * exists, and threading an "or start one" branch through it would blur the
 * one thing worth keeping simple there.
 */
export function WaStartComposer({
  leadId,
  leadName,
  canAct,
  canSendTemplate,
  providerLabel,
  templates,
  onSent,
}: {
  leadId: string;
  leadName: string;
  canAct: boolean;
  canSendTemplate: boolean;
  providerLabel: string;
  templates: WaTemplateOpt[];
  onSent: () => void;
}) {
  const [templateId, setTemplateId] = useState("");
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);

  const missingVars = useMemo(() => {
    if (!selected) return [];
    return Array.from({ length: selected.variableCount }, (_, i) => String(i + 1)).filter(
      (slot) => !templateVars[slot]?.trim(),
    );
  }, [selected, templateVars]);

  async function send() {
    if (!selected) return;
    setError(null);
    setSending(true);
    const res = await fetch(`/api/crm/leads/${leadId}/wa/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        template: selected.name,
        templateParams: templateVars,
        renderedBody: renderedTemplateText(selected, templateVars),
      }),
    }).catch(() => null);
    setSending(false);

    if (!res) {
      setError("Network error — the message was not sent.");
      return;
    }
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(d?.message ?? "The message could not be sent.");
      return;
    }
    setTemplateId("");
    setTemplateVars({});
    onSent();
  }

  if (!canAct) return null;

  if (!canSendTemplate) {
    return (
      <p className="text-label-sm text-on-surface-variant">
        {providerLabel} can’t send templates from the CRM, so a first message can’t be started here.
      </p>
    );
  }

  return (
    <div className="space-y-xs">
      <p className="text-label-sm text-on-surface-variant">
        {leadName || "This candidate"} has never messaged the business number, so an approved template is the only
        way to start.
      </p>
      {error && <p className="text-label-sm text-error">{error}</p>}
      {templates.length === 0 ? (
        <p className="text-label-sm text-on-surface-variant">
          No templates have been assigned to you. An admin can grant them under CRM → Message Templates.
        </p>
      ) : (
        <>
          <select
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setTemplateVars({});
            }}
            className="w-full h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none"
          >
            <option value="">Choose a template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>

          {selected && (
            <>
              {selected.variableCount > 0 && (
                <div className="flex flex-wrap gap-sm">
                  {Array.from({ length: selected.variableCount }, (_, i) => String(i + 1)).map((slot) => (
                    <label key={slot} className="block">
                      <span className="block text-label-sm text-on-surface-variant mb-xs">{`{{${slot}}}`}</span>
                      <input
                        value={templateVars[slot] ?? ""}
                        onChange={(e) => setTemplateVars((v) => ({ ...v, [slot]: e.target.value }))}
                        className="h-9 px-md w-44 rounded-lg border border-outline-variant bg-surface-container-lowest text-label-sm focus:border-primary outline-none"
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="rounded-lg border border-outline-variant bg-surface-container-low p-sm space-y-xs">
                <span className="block text-label-sm text-on-surface-variant">This is what will be sent</span>
                {selected.header && (
                  <p className="text-label-sm font-semibold text-on-surface whitespace-pre-wrap">{selected.header}</p>
                )}
                <p className="text-body-md text-on-surface whitespace-pre-wrap">
                  {fillPreview(selected.body, templateVars) || "(this template has no body text)"}
                </p>
                {missingVars.length > 0 && (
                  <p className="text-label-sm text-error">
                    Fill {missingVars.map((s) => `{{${s}}}`).join(", ")} before sending.
                  </p>
                )}
              </div>

              <button
                type="button"
                disabled={sending || missingVars.length > 0}
                onClick={() => void send()}
                className="h-9 px-lg rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-40"
              >
                {sending ? "Starting…" : "Start conversation"}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
