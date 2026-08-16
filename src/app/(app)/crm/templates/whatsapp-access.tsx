"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Who may send which approved WhatsApp template.
 *
 * Templates live at Meta and the API shows every one of them to everybody, so
 * without this a consultant's picker offers the entire catalogue — templates for
 * other services, other markets, other campaigns. Picking the wrong one sends a
 * real message to a real candidate, and there is no undo.
 *
 * Default is DENY, which is stated on screen rather than left to be discovered:
 * a template nobody has been granted is admin-only.
 */

type Tpl = {
  key: string;
  name: string;
  language: string;
  category: string | null;
  body: string | null;
  variableCount: number;
};
type Grant = { id: string; templateKey: string; userId: string | null; leadPulseRole: string | null };
type Bde = { userId: string; displayName: string; role: string };

type Payload = {
  supported: boolean;
  providerLabel: string;
  templates: Tpl[];
  grants: Grant[];
  bdes: Bde[];
};

const card = "bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm";
const chip = "px-sm h-7 rounded-full text-label-sm font-semibold transition border";
const TIERS: { value: "l1" | "l2" | "supervisor"; label: string }[] = [
  { value: "l1", label: "All L1" },
  { value: "l2", label: "All L2" },
  { value: "supervisor", label: "All supervisors" },
];

export function WhatsAppTemplateAccessCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/crm/wa/template-access").catch(() => null);
    setLoading(false);
    if (!r?.ok) return;
    setData((await r.json()) as Payload);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(templateKey: string, subject: { userId?: string; leadPulseRole?: string }, grant: boolean) {
    const id = `${templateKey}:${subject.userId ?? subject.leadPulseRole}`;
    setBusy(id);
    await fetch("/api/crm/wa/template-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateKey, ...subject, grant }),
    }).catch(() => null);
    setBusy(null);
    void load();
  }

  if (loading) return <div className={card + " p-lg text-on-surface-variant"}>Loading templates…</div>;

  if (!data?.supported) {
    return (
      <div className={card + " p-lg text-on-surface-variant"}>
        {data?.providerLabel ?? "The live transport"} cannot list templates, so there is nothing to assign. This needs
        the WhatsApp Cloud API.
      </div>
    );
  }

  return (
    <div className="space-y-lg">
      <div className={card + " p-lg space-y-xs"}>
        <h3 className="text-h3 text-on-surface">WhatsApp template access</h3>
        <p className="text-label-sm text-on-surface-variant">
          Approved templates from the WhatsApp Business Account. A consultant only sees the ones assigned to them —
          personally, or through their role.
        </p>
        <p className="text-label-sm text-on-surface-variant">
          <span className="font-semibold text-on-surface">A template with nobody assigned is admin-only.</span> That is
          the default, so a newly approved template is never visible to the whole team the moment Meta approves it.
        </p>
      </div>

      {data.templates.length === 0 && (
        <div className={card + " p-lg text-on-surface-variant"}>
          No approved templates found in the WhatsApp Business Account.
        </div>
      )}

      {data.templates.map((t) => {
        const grants = data.grants.filter((g) => g.templateKey === t.key);
        const grantedUsers = new Set(grants.map((g) => g.userId).filter(Boolean) as string[]);
        const grantedTiers = new Set(grants.map((g) => g.leadPulseRole).filter(Boolean) as string[]);

        return (
          <div key={t.key} className={card + " p-lg space-y-md"}>
            <div className="flex flex-wrap items-baseline gap-sm">
              <span className="text-body-md font-semibold text-on-surface">{t.name}</span>
              <span className="text-label-sm font-mono text-on-surface-variant">{t.language}</span>
              {t.category && (
                <span className="px-sm h-6 inline-flex items-center rounded-full bg-surface-container text-label-sm text-on-surface-variant">
                  {t.category}
                </span>
              )}
              {t.variableCount > 0 && (
                <span className="text-label-sm text-on-surface-variant">
                  {t.variableCount} value{t.variableCount === 1 ? "" : "s"} to fill
                </span>
              )}
              {grants.length === 0 && (
                <span className="text-label-sm text-error font-semibold ml-auto">Nobody assigned — admins only</span>
              )}
            </div>

            {t.body && (
              <p className="text-label-sm text-on-surface-variant whitespace-pre-wrap border border-outline-variant rounded-lg p-sm bg-surface-container-low">
                {t.body}
              </p>
            )}

            <div className="space-y-sm">
              <div className="flex flex-wrap items-center gap-xs">
                <span className="text-label-sm text-on-surface-variant mr-xs">By role</span>
                {TIERS.map((tier) => {
                  const on = grantedTiers.has(tier.value);
                  return (
                    <button
                      key={tier.value}
                      type="button"
                      disabled={busy === `${t.key}:${tier.value}`}
                      onClick={() => void toggle(t.key, { leadPulseRole: tier.value }, !on)}
                      className={
                        chip +
                        " " +
                        (on
                          ? "bg-primary text-on-primary border-primary"
                          : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
                      }
                    >
                      {tier.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-xs">
                <span className="text-label-sm text-on-surface-variant mr-xs">By person</span>
                {data.bdes.map((b) => {
                  const on = grantedUsers.has(b.userId);
                  const covered = grantedTiers.has(b.role);
                  return (
                    <button
                      key={b.userId}
                      type="button"
                      disabled={busy === `${t.key}:${b.userId}`}
                      onClick={() => void toggle(t.key, { userId: b.userId }, !on)}
                      title={covered && !on ? `Already allowed through their role (${b.role})` : undefined}
                      className={
                        chip +
                        " " +
                        (on
                          ? "bg-primary text-on-primary border-primary"
                          : covered
                            ? "border-primary/40 text-primary/70 hover:bg-surface-container-low"
                            : "border-outline-variant text-on-surface-variant hover:bg-surface-container-low")
                      }
                    >
                      {b.displayName}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
