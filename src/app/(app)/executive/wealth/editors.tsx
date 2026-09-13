"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ASSET_CLASS_META,
  LIABILITY_KINDS,
  LIABILITY_KIND_LABEL,
  SELECTABLE_ASSET_CLASSES,
  type AssetClassKey,
  type GoldItemRow,
  type HoldingRow,
  type LiabilityRow,
} from "@/lib/wealth-model";
import { WEALTH_FREQUENCIES, type WealthFrequency } from "@/lib/wealth-reminders";

export const inputCls =
  "w-full h-10 px-md rounded-lg border border-outline-variant bg-surface-container-lowest focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition text-body-md";
export const primaryBtn =
  "h-10 px-lg rounded-lg bg-primary text-on-primary font-semibold hover:bg-primary-container transition disabled:opacity-60";
export const secondaryBtn =
  "h-10 px-lg rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-low transition disabled:opacity-60";

const FREQUENCY_LABEL: Record<WealthFrequency, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
  three_yearly: "Every 3 years",
  one_time: "One-time",
  none: "No schedule",
};

const LEAD_CHOICES = [
  { days: 3, label: "3 days before" },
  { days: 7, label: "A week before" },
  { days: 14, label: "2 weeks before" },
  { days: 30, label: "A month before" },
  { days: 42, label: "6 weeks before" },
];

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-label-sm text-on-surface-variant mb-xs">{label}</span>
      {children}
      {hint && <span className="block text-caption text-on-surface-variant mt-xs">{hint}</span>}
    </label>
  );
}

/** A right-hand drawer. Rendered through a portal so it is never clipped by a
 *  card's overflow, and closes on Escape or a click on the scrim. */
export function Drawer({
  open,
  title,
  eyebrow,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[460px] z-50 bg-surface-container-lowest border-l border-outline-variant shadow-xl flex flex-col"
      >
        <div className="flex items-start gap-md px-lg py-md border-b border-outline-variant">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p className="text-label-sm uppercase tracking-wider text-on-surface-variant">{eyebrow}</p>
            )}
            <h3 className="text-h3 text-on-surface truncate">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 grid place-items-center rounded-lg hover:bg-surface-container-low text-on-surface-variant"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-lg py-lg space-y-lg">{children}</div>
        <div className="px-lg py-md border-t border-outline-variant bg-surface-container-low flex items-center gap-sm">
          {footer}
        </div>
      </aside>
    </>,
    document.body,
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-body-md text-error bg-error-container/40 border border-error/30 rounded-lg px-md py-sm">
      {message}
    </p>
  );
}

// ── Holding editor ──────────────────────────────────────────────────────────

export type HoldingDraft = {
  name: string;
  assetClass: AssetClassKey;
  scope: "personal" | "business";
  holderLabel: string;
  institution: string;
  policyNo: string;
  contributionAmount: string;
  frequency: WealthFrequency;
  dueDayOfMonth: string;
  renewalOn: string;
  sumAssured: string;
  reminderLeadDays: number;
  portalUrl: string;
  portalUsername: string;
  portalPassword: string;
  notes: string;
  value: string;
  valuedOn: string;
};

export function emptyHoldingDraft(today: string): HoldingDraft {
  return {
    name: "",
    assetClass: "equity",
    scope: "personal",
    holderLabel: "Self",
    institution: "",
    policyNo: "",
    contributionAmount: "",
    frequency: "none",
    dueDayOfMonth: "",
    renewalOn: "",
    sumAssured: "",
    reminderLeadDays: 7,
    portalUrl: "",
    portalUsername: "",
    portalPassword: "",
    notes: "",
    value: "",
    valuedOn: today,
  };
}

export function draftFromHolding(h: HoldingRow, today: string): HoldingDraft {
  return {
    name: h.name,
    assetClass: h.assetClass,
    scope: h.scope,
    holderLabel: h.holderLabel,
    institution: h.institution ?? "",
    policyNo: h.policyNo ?? "",
    contributionAmount: h.contributionAmount == null ? "" : String(h.contributionAmount),
    frequency: h.frequency,
    dueDayOfMonth: h.dueDayOfMonth == null ? "" : String(h.dueDayOfMonth),
    renewalOn: h.renewalOn ?? "",
    sumAssured: h.sumAssured == null ? "" : String(h.sumAssured),
    reminderLeadDays: h.reminderLeadDays,
    portalUrl: h.portalUrl ?? "",
    portalUsername: h.portalUsername ?? "",
    portalPassword: "",
    notes: h.notes ?? "",
    value: h.value ? String(h.value) : "",
    valuedOn: h.valuedOn ?? today,
  };
}

export function HoldingForm({
  draft,
  set,
  holding,
  secretVaultConfigured,
  onReveal,
  revealed,
  revealBusy,
}: {
  draft: HoldingDraft;
  set: <K extends keyof HoldingDraft>(key: K, value: HoldingDraft[K]) => void;
  holding: HoldingRow | null;
  secretVaultConfigured: boolean;
  onReveal: () => void;
  revealed: string | null;
  revealBusy: boolean;
}) {
  const anchored = draft.frequency !== "monthly" && draft.frequency !== "none";
  const isProtection = draft.assetClass === "protection";

  return (
    <>
      <Field label="Name">
        <input
          className={inputCls}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Axis Mutual Fund"
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-2 gap-md">
        <Field label="Asset class">
          <select
            className={inputCls}
            value={draft.assetClass}
            onChange={(e) => set("assetClass", e.target.value as AssetClassKey)}
          >
            {SELECTABLE_ASSET_CLASSES.map((k) => (
              <option key={k} value={k}>
                {ASSET_CLASS_META[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Held for">
          <input
            className={inputCls}
            value={draft.holderLabel}
            onChange={(e) => set("holderLabel", e.target.value)}
            placeholder="Self"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-md">
        <Field label="Institution">
          <input
            className={inputCls}
            value={draft.institution}
            onChange={(e) => set("institution", e.target.value)}
            placeholder="e.g. SBI Life"
          />
        </Field>
        <Field label="Policy / folio no">
          <input
            className={inputCls}
            value={draft.policyNo}
            onChange={(e) => set("policyNo", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Counts as">
        <div className="flex items-center gap-xs bg-surface-container rounded-lg p-[3px]">
          {(["personal", "business"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => set("scope", s)}
              className={
                "flex-1 h-8 rounded-md text-label-sm font-semibold capitalize transition " +
                (draft.scope === s
                  ? "bg-surface-container-lowest text-on-surface shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface")
              }
            >
              {s}
            </button>
          ))}
        </div>
      </Field>

      <fieldset className="border border-outline-variant rounded-xl p-md space-y-md">
        <legend className="px-xs text-label-sm uppercase tracking-wider text-on-surface-variant">
          {isProtection ? "Cover" : "Current value"}
        </legend>
        {isProtection ? (
          <Field label="Sum assured (₹)" hint="Cover is reported separately and never added to net worth.">
            <input
              className={inputCls}
              inputMode="decimal"
              value={draft.sumAssured}
              onChange={(e) => set("sumAssured", e.target.value)}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-md">
            <Field label="Value (₹)">
              <input
                className={inputCls}
                inputMode="decimal"
                value={draft.value}
                onChange={(e) => set("value", e.target.value)}
              />
            </Field>
            <Field label="Valued on">
              <input
                type="date"
                className={inputCls}
                value={draft.valuedOn}
                onChange={(e) => set("valuedOn", e.target.value)}
              />
            </Field>
          </div>
        )}
        {!isProtection && (
          <p className="text-caption text-on-surface-variant">
            Saving a new value keeps the old one — valuations are a history, not an overwrite.
          </p>
        )}
      </fieldset>

      <fieldset className="border border-outline-variant rounded-xl p-md space-y-md">
        <legend className="px-xs text-label-sm uppercase tracking-wider text-on-surface-variant">
          Contribution &amp; reminder
        </legend>
        <div className="grid grid-cols-2 gap-md">
          <Field label="Amount (₹)">
            <input
              className={inputCls}
              inputMode="decimal"
              value={draft.contributionAmount}
              onChange={(e) => set("contributionAmount", e.target.value)}
              placeholder="Not captured"
            />
          </Field>
          <Field label="Frequency">
            <select
              className={inputCls}
              value={draft.frequency}
              onChange={(e) => set("frequency", e.target.value as WealthFrequency)}
            >
              {WEALTH_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {draft.frequency !== "none" && (
          <div className="grid grid-cols-2 gap-md">
            {anchored ? (
              <Field label="Next date" hint="The cycle repeats from here.">
                <input
                  type="date"
                  className={inputCls}
                  value={draft.renewalOn}
                  onChange={(e) => set("renewalOn", e.target.value)}
                />
              </Field>
            ) : (
              <Field label="Day of month" hint="1–31; short months clamp to the last day.">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  value={draft.dueDayOfMonth}
                  onChange={(e) => set("dueDayOfMonth", e.target.value)}
                  placeholder="e.g. 20"
                />
              </Field>
            )}
            <Field label="Remind me">
              <select
                className={inputCls}
                value={draft.reminderLeadDays}
                onChange={(e) => set("reminderLeadDays", Number(e.target.value))}
              >
                {LEAD_CHOICES.map((c) => (
                  <option key={c.days} value={c.days}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </fieldset>

      <fieldset className="border border-outline-variant rounded-xl p-md space-y-md">
        <legend className="px-xs text-label-sm uppercase tracking-wider text-on-surface-variant">
          Portal access
        </legend>
        <Field label="Portal URL">
          <input
            className={inputCls}
            value={draft.portalUrl}
            onChange={(e) => set("portalUrl", e.target.value)}
            placeholder="https://"
          />
        </Field>
        <Field label="Username">
          <input
            className={inputCls}
            value={draft.portalUsername}
            onChange={(e) => set("portalUsername", e.target.value)}
          />
        </Field>

        {secretVaultConfigured ? (
          <>
            <Field
              label="Password"
              hint={
                holding?.hasSecret
                  ? "A password is stored. Leave blank to keep it, or type a new one to replace it."
                  : "Encrypted with a key held outside the database. Every reveal is logged."
              }
            >
              <input
                type="password"
                className={inputCls}
                value={draft.portalPassword}
                onChange={(e) => set("portalPassword", e.target.value)}
                placeholder={holding?.hasSecret ? "••••••••" : ""}
                autoComplete="new-password"
              />
            </Field>
            {holding?.hasSecret && (
              <div className="flex items-center gap-sm">
                <button type="button" className={secondaryBtn} onClick={onReveal} disabled={revealBusy}>
                  <span className="material-symbols-outlined align-middle mr-xs" style={{ fontSize: 18 }}>
                    visibility
                  </span>
                  {revealBusy ? "Opening…" : "Reveal stored password"}
                </button>
                {revealed && (
                  <code className="text-body-md font-mono bg-surface-container px-sm py-xs rounded border border-outline-variant">
                    {revealed}
                  </code>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-caption text-on-surface-variant bg-surface-container-low border border-outline-variant rounded-lg px-md py-sm">
            Password storage is switched off because <code>WEALTH_SECRET_KEY</code> is not set on the
            server. Portal and username are still saved — the password stays wherever you keep it today.
          </p>
        )}
      </fieldset>

      <Field label="Notes">
        <textarea
          className={inputCls + " h-auto py-sm"}
          rows={2}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Anything worth remembering about this holding"
        />
      </Field>
    </>
  );
}

// ── Liability editor ────────────────────────────────────────────────────────

export type LiabilityDraft = {
  name: string;
  kind: string;
  scope: "personal" | "business";
  lender: string;
  outstanding: string;
  interestRate: string;
  emiAmount: string;
  emiDayOfMonth: string;
  tenureMonths: string;
  startedOn: string;
  notes: string;
  closed: boolean;
};

export function emptyLiabilityDraft(): LiabilityDraft {
  return {
    name: "",
    kind: "housing",
    scope: "personal",
    lender: "",
    outstanding: "",
    interestRate: "",
    emiAmount: "",
    emiDayOfMonth: "",
    tenureMonths: "",
    startedOn: "",
    notes: "",
    closed: false,
  };
}

export function draftFromLiability(l: LiabilityRow): LiabilityDraft {
  return {
    name: l.name,
    kind: l.kind,
    scope: l.scope,
    lender: l.lender ?? "",
    outstanding: String(l.outstanding),
    interestRate: l.interestRate == null ? "" : String(l.interestRate),
    emiAmount: l.emiAmount == null ? "" : String(l.emiAmount),
    emiDayOfMonth: l.emiDayOfMonth == null ? "" : String(l.emiDayOfMonth),
    tenureMonths: l.tenureMonths == null ? "" : String(l.tenureMonths),
    startedOn: l.startedOn ?? "",
    notes: l.notes ?? "",
    closed: l.isClosed,
  };
}

export function LiabilityForm({
  draft,
  set,
}: {
  draft: LiabilityDraft;
  set: <K extends keyof LiabilityDraft>(key: K, value: LiabilityDraft[K]) => void;
}) {
  return (
    <>
      <Field label="Name">
        <input
          className={inputCls}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Housing loan"
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-md">
        <Field label="Kind">
          <select className={inputCls} value={draft.kind} onChange={(e) => set("kind", e.target.value)}>
            {LIABILITY_KINDS.map((k) => (
              <option key={k} value={k}>
                {LIABILITY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Lender">
          <input className={inputCls} value={draft.lender} onChange={(e) => set("lender", e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-md">
        <Field label="Outstanding (₹)">
          <input
            className={inputCls}
            inputMode="decimal"
            value={draft.outstanding}
            onChange={(e) => set("outstanding", e.target.value)}
          />
        </Field>
        <Field label="Interest rate (%)">
          <input
            className={inputCls}
            inputMode="decimal"
            value={draft.interestRate}
            onChange={(e) => set("interestRate", e.target.value)}
            placeholder="e.g. 8.75"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-md">
        <Field label="EMI (₹)">
          <input
            className={inputCls}
            inputMode="decimal"
            value={draft.emiAmount}
            onChange={(e) => set("emiAmount", e.target.value)}
          />
        </Field>
        <Field label="EMI day" hint="Set this and the EMI joins the reminder rail.">
          <input
            className={inputCls}
            inputMode="numeric"
            value={draft.emiDayOfMonth}
            onChange={(e) => set("emiDayOfMonth", e.target.value)}
            placeholder="e.g. 5"
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-md">
        <Field label="Started on">
          <input
            type="date"
            className={inputCls}
            value={draft.startedOn}
            onChange={(e) => set("startedOn", e.target.value)}
          />
        </Field>
        <Field label="Tenure (months)">
          <input
            className={inputCls}
            inputMode="numeric"
            value={draft.tenureMonths}
            onChange={(e) => set("tenureMonths", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Notes">
        <textarea
          className={inputCls + " h-auto py-sm"}
          rows={2}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-sm text-body-md">
        <input
          type="checkbox"
          checked={draft.closed}
          onChange={(e) => set("closed", e.target.checked)}
          className="h-4 w-4"
        />
        Closed — keep it on the page as history, stop counting it
      </label>
    </>
  );
}

// ── Gold editor ─────────────────────────────────────────────────────────────

export type GoldDraft = {
  category: string;
  name: string;
  grams: string;
  holderLabel: string;
  purityKarat: string;
  dueOn: string;
  notes: string;
};

export function emptyGoldDraft(): GoldDraft {
  return { category: "", name: "", grams: "", holderLabel: "Self", purityKarat: "", dueOn: "", notes: "" };
}

export function draftFromGold(g: GoldItemRow): GoldDraft {
  return {
    category: g.category,
    name: g.name,
    grams: String(g.grams),
    holderLabel: g.holderLabel,
    purityKarat: g.purityKarat == null ? "" : String(g.purityKarat),
    dueOn: g.dueOn ?? "",
    notes: g.notes ?? "",
  };
}

export function GoldForm({
  draft,
  set,
  categories,
}: {
  draft: GoldDraft;
  set: <K extends keyof GoldDraft>(key: K, value: GoldDraft[K]) => void;
  categories: string[];
}) {
  const listId = useRef(`gold-cats-${Math.random().toString(36).slice(2)}`).current;
  return (
    <>
      <div className="grid grid-cols-2 gap-md">
        <Field label="Category">
          <input
            className={inputCls}
            list={listId}
            value={draft.category}
            onChange={(e) => set("category", e.target.value)}
            placeholder="e.g. Chains"
            autoFocus
          />
          <datalist id={listId}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Held for">
          <input
            className={inputCls}
            value={draft.holderLabel}
            onChange={(e) => set("holderLabel", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Piece">
        <input className={inputCls} value={draft.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-md">
        <Field label="Grams">
          <input
            className={inputCls}
            inputMode="decimal"
            value={draft.grams}
            onChange={(e) => set("grams", e.target.value)}
          />
        </Field>
        <Field label="Purity (karat)">
          <input
            className={inputCls}
            inputMode="numeric"
            value={draft.purityKarat}
            onChange={(e) => set("purityKarat", e.target.value)}
            placeholder="22"
          />
        </Field>
      </div>
      <Field label="Scheme delivery date" hint="For instalments bought but not yet taken.">
        <input
          type="date"
          className={inputCls}
          value={draft.dueOn}
          onChange={(e) => set("dueOn", e.target.value)}
        />
      </Field>
      <Field label="Notes">
        <textarea
          className={inputCls + " h-auto py-sm"}
          rows={2}
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </Field>
    </>
  );
}
