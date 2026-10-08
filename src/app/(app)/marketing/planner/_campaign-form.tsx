"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_LABELS,
  MKT_PLANNER_HREF,
  parseRupees,
  type CampaignType,
  type ChannelDto,
  type UserOpt,
} from "@/lib/mkt-planner-shared";
import { plannerApi } from "./_api";
import { ghostBtnClass, ghostBtnStyle, inputClass, inputStyle, primaryBtnClass, primaryBtnStyle } from "./_ui";

export type CampaignFormValue = {
  id?: string;
  name: string;
  type: CampaignType;
  channelId: string | null;
  ownerId: string | null;
  startDate: string | null;
  endDate: string | null;
  budget: number;
  code: string | null;
  brief: string | null;
  audience: string | null;
  services: string | null;
  targetLeads: number | null;
  targetEnrollments: number | null;
};

const BLANK: CampaignFormValue = {
  name: "",
  type: "performance",
  channelId: null,
  ownerId: null,
  startDate: null,
  endDate: null,
  budget: 0,
  code: null,
  brief: null,
  audience: null,
  services: null,
  targetLeads: null,
  targetEnrollments: null,
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-[5px] text-[12px]" style={{ color: "var(--lp-on-surface-variant)" }}>
      {label}
      {children}
      {hint && (
        <span className="text-[11px]" style={{ color: "var(--lp-outline)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

const intOrNull = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const n = parseRupees(t);
  return n;
};

/** Right-hand drawer to create or edit a campaign. */
export function CampaignForm({
  initial,
  channels,
  users,
  onClose,
  isApproved,
  admin,
}: {
  initial?: Partial<CampaignFormValue>;
  channels: ChannelDto[];
  users: UserOpt[];
  onClose: () => void;
  isApproved?: boolean;
  admin?: boolean;
}) {
  const router = useRouter();
  const start = { ...BLANK, ...initial };
  const editing = !!start.id;
  const [v, setV] = useState(start);
  const [budgetText, setBudgetText] = useState(start.budget ? String(start.budget) : "");
  const [leadsText, setLeadsText] = useState(start.targetLeads?.toString() ?? "");
  const [enrolText, setEnrolText] = useState(start.targetEnrollments?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof CampaignFormValue>(k: K, val: CampaignFormValue[K]) => setV((p) => ({ ...p, [k]: val }));

  async function save() {
    setError(null);
    const budget = budgetText.trim() ? parseRupees(budgetText) : 0;
    if (budget === null) return setError("Budget must be a whole rupee amount, like 1,60,000.");
    const targetLeads = intOrNull(leadsText);
    const targetEnrollments = intOrNull(enrolText);
    if (leadsText.trim() && targetLeads === null) return setError("Target leads must be a whole number.");
    if (enrolText.trim() && targetEnrollments === null) return setError("Target enrollments must be a whole number.");
    if (!v.name.trim()) return setError("Give it a name.");
    const body = {
      name: v.name.trim(),
      type: v.type,
      channelId: v.channelId || null,
      ownerId: v.ownerId || null,
      startDate: v.startDate || null,
      endDate: v.endDate || null,
      budget,
      code: v.code?.trim() || null,
      brief: v.brief?.trim() || null,
      audience: v.audience?.trim() || null,
      services: v.services?.trim() || null,
      targetLeads,
      targetEnrollments,
    };
    setBusy(true);
    try {
      if (editing) {
        await plannerApi("PATCH", `/api/marketing/planner/campaigns/${start.id}`, body);
        onClose();
        router.refresh();
      } else {
        const { id } = await plannerApi<{ id: string }>("POST", "/api/marketing/planner/campaigns", body);
        router.push(`${MKT_PLANNER_HREF}/campaigns/${id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  }

  const activeChannels = channels.filter((c) => c.active || c.id === start.channelId);

  return (
    <div className="fixed inset-0 z-50" style={{ backgroundColor: "rgba(0, 0, 0, 0.55)" }} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-form-title"
        onClick={(e) => e.stopPropagation()}
        className="absolute right-0 top-0 h-full w-full max-w-[520px] overflow-y-auto border-l p-[22px] flex flex-col gap-[14px] lp-scope"
        style={{
          backgroundColor: "var(--lp-surface, #171309)",
          borderColor: "rgba(245, 197, 24, 0.18)",
          color: "var(--lp-on-surface, #ebe2d0)",
        }}
      >
        <div className="flex items-center justify-between gap-[10px]">
          <h2 id="campaign-form-title" className="font-display text-[18px] font-semibold">
            {editing ? "Edit campaign" : "New campaign"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-[40px] h-[40px] rounded-[8px] flex items-center justify-center">
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        {editing && isApproved && !admin && (
          <p className="text-[12px] rounded-[8px] px-[12px] py-[10px]" style={{ backgroundColor: "rgba(255, 182, 147, 0.08)", color: "var(--lp-orange)" }}>
            This campaign is approved. Changing its budget, channel or dates sends it back for approval.
          </p>
        )}

        <Field label="Name">
          <input className={inputClass} style={inputStyle} value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-[12px]">
          <Field label="Type">
            <select className={inputClass} style={inputStyle} value={v.type} onChange={(e) => set("type", e.target.value as CampaignType)}>
              {CAMPAIGN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CAMPAIGN_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Draws from channel">
            <select className={inputClass} style={inputStyle} value={v.channelId ?? ""} onChange={(e) => set("channelId", e.target.value || null)}>
              <option value="">No channel</option>
              {activeChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-[12px]">
          <Field label="Starts" hint="Leave empty to keep it as an unscheduled idea.">
            <input type="date" className={`${inputClass} lp-date-input`} style={inputStyle} value={v.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || null)} />
          </Field>
          <Field label="Ends" hint="Empty = a one-day event.">
            <input type="date" className={`${inputClass} lp-date-input`} style={inputStyle} value={v.endDate ?? ""} min={v.startDate ?? undefined} onChange={(e) => set("endDate", e.target.value || null)} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-[12px]">
          <Field label="Budget (₹)">
            <input className={`${inputClass} font-mono text-right`} style={inputStyle} inputMode="numeric" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} placeholder="1,60,000" />
          </Field>
          <Field label="Owner">
            <select className={inputClass} style={inputStyle} value={v.ownerId ?? ""} onChange={(e) => set("ownerId", e.target.value || null)}>
              <option value="">{editing ? "Nobody" : "Me"}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="CRM campaign code" hint="Leads whose Campaign field matches this (any case) count as this campaign's results.">
          <input className={`${inputClass} font-mono`} style={inputStyle} value={v.code ?? ""} onChange={(e) => set("code", e.target.value)} maxLength={80} placeholder="SEM-NOV26" />
        </Field>

        <Field label="Brief">
          <textarea className={inputClass} style={inputStyle} rows={4} value={v.brief ?? ""} onChange={(e) => set("brief", e.target.value)} maxLength={4000} />
        </Field>

        <div className="grid grid-cols-2 gap-[12px]">
          <Field label="Audience">
            <input className={inputClass} style={inputStyle} value={v.audience ?? ""} onChange={(e) => set("audience", e.target.value)} maxLength={300} />
          </Field>
          <Field label="Services promoted">
            <input className={inputClass} style={inputStyle} value={v.services ?? ""} onChange={(e) => set("services", e.target.value)} maxLength={300} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-[12px]">
          <Field label="Target leads">
            <input className={`${inputClass} font-mono text-right`} style={inputStyle} inputMode="numeric" value={leadsText} onChange={(e) => setLeadsText(e.target.value)} />
          </Field>
          <Field label="Target enrollments">
            <input className={`${inputClass} font-mono text-right`} style={inputStyle} inputMode="numeric" value={enrolText} onChange={(e) => setEnrolText(e.target.value)} />
          </Field>
        </div>

        {error && (
          <p role="alert" className="text-[13px]" style={{ color: "var(--lp-error)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-[8px] pt-[4px]">
          <button type="button" onClick={save} disabled={busy} className={`${primaryBtnClass} flex-1`} style={primaryBtnStyle}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create campaign"}
          </button>
          <button type="button" onClick={onClose} className={ghostBtnClass} style={ghostBtnStyle}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** "New campaign" button that owns its drawer — drop-in for server-rendered pages. */
export function NewCampaignButton({
  channels,
  users,
  label = "New campaign",
  preset,
}: {
  channels: ChannelDto[];
  users: UserOpt[];
  label?: string;
  preset?: Partial<CampaignFormValue>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primaryBtnClass} style={primaryBtnStyle}>
        <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
          add
        </span>
        {label}
      </button>
      {open && <CampaignForm initial={preset} channels={channels} users={users} onClose={() => setOpen(false)} />}
    </>
  );
}
