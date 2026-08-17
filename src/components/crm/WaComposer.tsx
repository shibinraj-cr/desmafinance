"use client";

import { useMemo, useState } from "react";

/**
 * The WhatsApp send box — one implementation, used by the inbox and by the
 * lead's WhatsApp tab.
 *
 * Shared rather than copied, because the rules it encodes are the ones most
 * costly to get subtly different in two places: WhatsApp's 24-hour free-text
 * window, when a template is the only legal send, and which template parameters
 * must be filled before Meta accepts the call. A second copy would drift, and
 * the drift would surface as a rejected send to a real candidate.
 */

export type WaTemplateOpt = {
  id: string;
  /** `name:language` — what the send API is given. */
  name: string;
  /** Human label for the dropdown. */
  label: string;
  /** The real body text, `{{1}}` placeholders intact. */
  body: string | null;
  header: string | null;
  variableCount: number;
};

/**
 * Substitute `{{n}}` for the preview. Unfilled placeholders stay visible, so a
 * half-completed template reads as obviously incomplete rather than as a message
 * with a gap in it.
 */
export function fillPreview(body: string | null, params: Record<string, string>): string {
  if (!body) return "";
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, n: string) => params[n]?.trim() || whole);
}

export function WaComposer({
  conversationId,
  sessionOpen,
  canAct,
  canSendText,
  canSendTemplate,
  providerLabel,
  templates,
  onSent,
}: {
  conversationId: string;
  sessionOpen: boolean;
  canAct: boolean;
  canSendText: boolean;
  canSendTemplate: boolean;
  providerLabel: string;
  templates: WaTemplateOpt[];
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A template is legal BOTH inside and outside the window; only free text is
  // restricted. So the window narrows the choice rather than dictating it —
  // treating the two as mutually exclusive would hide the template picker during
  // an open session, which on a transport that cannot do free text leaves no way
  // to reply at all. Outside the window, template is simply the only option left.
  const [mode, setMode] = useState<"text" | "template">(sessionOpen && canSendText ? "text" : "template");
  const effectiveMode = sessionOpen ? mode : "template";
  const canChoose = sessionOpen && canSendText && canSendTemplate;
  const capable = effectiveMode === "text" ? canSendText : canSendTemplate;
  const selected = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);

  // Which placeholders are still empty. Blocks Send rather than letting Meta
  // reject the call — and stops a half-filled template reaching a candidate.
  const missingVars = useMemo(() => {
    if (!selected) return [];
    return Array.from({ length: selected.variableCount }, (_, i) => String(i + 1)).filter(
      (slot) => !templateVars[slot]?.trim(),
    );
  }, [selected, templateVars]);

  async function send() {
    setError(null);
    setSending(true);
    // Exactly one of the two — the server rejects a request carrying both,
    // because only one would actually be delivered.
    const payload =
      effectiveMode === "text" ? { body: text } : { template: selected?.name, templateParams: templateVars };
    const res = await fetch(`/api/crm/wa/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
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
    setText("");
    setTemplateId("");
    setTemplateVars({});
    onSent();
  }

  if (!canAct) {
    return (
      <div className="px-md py-sm border-t border-outline-variant text-label-sm text-on-surface-variant">
        Read-only — only the assigned consultant or an admin can reply on this thread.
      </div>
    );
  }

  if (!capable) {
    // Neither mode works on this transport. Say so once, plainly, rather than
    // showing a control whose every use fails.
    return (
      <div className="px-md py-sm border-t border-outline-variant text-label-sm text-on-surface-variant">
        {canSendText || canSendTemplate
          ? effectiveMode === "text"
            ? `${providerLabel} can’t send free text — choose a template instead.`
            : `${providerLabel} can’t send templates from the CRM.`
          : `${providerLabel} can’t send from the CRM. This starts working when the number moves to the Cloud API.`}
      </div>
    );
  }

  return (
    <div className="px-md py-sm border-t border-outline-variant space-y-xs">
      {error && <p className="text-label-sm text-error">{error}</p>}
      {canChoose && (
        <div className="inline-flex rounded-lg border border-outline-variant overflow-hidden">
          {(["text", "template"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                "px-md h-7 text-label-sm font-semibold transition " +
                (mode === m
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low")
              }
            >
              {m === "text" ? "Reply" : "Template"}
            </button>
          ))}
        </div>
      )}
      {effectiveMode === "text" ? (
        <div className="flex items-end gap-sm">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (text.trim() && !sending) void send();
              }
            }}
            rows={2}
            placeholder="Type a reply… (Enter to send, Shift+Enter for a new line)"
            className="flex-1 px-md py-sm rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md resize-none focus:border-primary outline-none"
          />
          <button
            type="button"
            disabled={!text.trim() || sending}
            onClick={() => void send()}
            className="h-10 px-lg rounded-lg bg-primary text-on-primary text-label-sm font-semibold disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      ) : (
        <div className="space-y-xs">
          {!sessionOpen && (
            <p className="text-label-sm text-on-surface-variant">
              The 24-hour reply window has closed — only an approved template can be sent.
            </p>
          )}

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
                  {/* Meta rejects a send whose parameter count does not match the
                      template, so the values are collected here rather than
                      discovered as an API error after the consultant pressed Send. */}
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

                  {/* The actual message, with values filled in. Sending a template
                      is irreversible and lands on a real candidate's phone, so
                      what goes out is shown before the button, not after. */}
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
                    {sending ? "Sending…" : "Send this message"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
