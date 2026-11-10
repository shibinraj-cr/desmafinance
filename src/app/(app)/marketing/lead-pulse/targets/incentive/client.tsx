"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SLAB_COUNT,
  computeBdePay,
  slabLadder,
  validateSlabs,
  type BdeMonthFacts,
  type MonthBonuses,
  type Slab,
  type SlabInput,
} from "@/lib/crm-incentive";

type Row = {
  userId: string;
  name: string;
  team: string | null;
  target: number;
  facts: BdeMonthFacts;
  minimum: number | null;
  slabs: Slab[];
};

type Setup = { minimum: number | null; slabs: SlabInput[] };
type Draft = { minimum: string; slabs: Array<{ from: string; rate: string }> };
type BonusDraft = Record<keyof MonthBonuses, string>;

const BONUS_FIELDS: Array<{ key: keyof MonthBonuses; label: string; each: boolean }> = [
  { key: "targetBonus", label: "Target reached", each: false },
  { key: "fastCloseBonus", label: "Closed within 48h", each: true },
  { key: "referralBonus", label: "Own referral enrolled", each: true },
];

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const str = (n: number | null) => (n === null ? "" : String(n));
/** Blank → null; anything else → a number (NaN when not one, so validation names it). */
const num = (s: string): number | null => {
  const t = s.replace(/[,₹\s]/g, "");
  return t === "" ? null : Number(t);
};

function toDraft(setup: Setup): Draft {
  const slabs = Array.from({ length: SLAB_COUNT }, (_, i) => setup.slabs[i] ?? { from: null, rate: null });
  return { minimum: str(setup.minimum), slabs: slabs.map((s) => ({ from: str(s.from), rate: str(s.rate) })) };
}

function fromDraft(d: Draft): Setup {
  return { minimum: num(d.minimum), slabs: d.slabs.map((s) => ({ from: num(s.from), rate: num(s.rate) })) };
}

function draftError(d: Draft): string | null {
  const min = num(d.minimum);
  if (min !== null && (!Number.isInteger(min) || min < 0)) return "Minimum must be a whole number.";
  return validateSlabs(fromDraft(d).slabs);
}

const same = (a: Setup, b: Setup) => JSON.stringify(a) === JSON.stringify(fromDraft(toDraft(b)));

/** The set slabs of a valid draft (both halves filled). */
const draftSlabs = (d: Draft): Slab[] =>
  fromDraft(d).slabs.flatMap((s) => (s.from !== null && s.rate !== null ? [{ from: s.from, rate: s.rate }] : []));

export function IncentiveSheet({
  year,
  month,
  monthName,
  prevName,
  readOnly,
  bonuses,
  rows,
  prev,
}: {
  year: number;
  month: number;
  monthName: string;
  prevName: string;
  readOnly: boolean;
  bonuses: MonthBonuses;
  rows: Row[];
  prev: { bonuses: MonthBonuses | null; rows: Array<{ userId: string } & Setup> };
}) {
  const router = useRouter();
  const initialOf = (r: Row): Setup => ({ minimum: r.minimum, slabs: r.slabs });
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(rows.map((r) => [r.userId, toDraft(initialOf(r))])),
  );
  const [bonusDraft, setBonusDraft] = useState<BonusDraft>(() => ({
    targetBonus: String(bonuses.targetBonus),
    fastCloseBonus: String(bonuses.fastCloseBonus),
    referralBonus: String(bonuses.referralBonus),
  }));
  const [selected, setSelected] = useState<string>(() => (rows.find((r) => r.slabs.length) ?? rows[0]).userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const bonusValues = useMemo(() => {
    const out = {} as Record<keyof MonthBonuses, number | null>;
    for (const f of BONUS_FIELDS) out[f.key] = num(bonusDraft[f.key]) ?? 0;
    return out;
  }, [bonusDraft]);
  const bonusError = BONUS_FIELDS.find((f) => {
    const v = bonusValues[f.key];
    return v === null || !Number.isInteger(v) || v < 0;
  });
  const liveBonuses: MonthBonuses = bonusError ? bonuses : (bonusValues as MonthBonuses);
  const bonusesChanged = BONUS_FIELDS.some((f) => bonusValues[f.key] !== bonuses[f.key]);

  const errors = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.userId, draftError(drafts[r.userId])])),
    [rows, drafts],
  );
  const changedRows = rows.filter((r) => !same(fromDraft(drafts[r.userId]), initialOf(r)));
  const invalid = Boolean(bonusError) || rows.some((r) => errors[r.userId]);
  const dirty = bonusesChanged || changedRows.length > 0;

  function setMinimum(userId: string, value: string) {
    setDrafts((d) => ({ ...d, [userId]: { ...d[userId], minimum: value } }));
  }
  function setSlab(userId: string, i: number, half: "from" | "rate", value: string) {
    setDrafts((d) => ({
      ...d,
      [userId]: { ...d[userId], slabs: d[userId].slabs.map((s, j) => (j === i ? { ...s, [half]: value } : s)) },
    }));
  }

  const canCopy = !readOnly && (prev.rows.length > 0 || prev.bonuses !== null);
  function copyPrevious() {
    const byUser = new Map(prev.rows.map((r) => [r.userId, r]));
    let copied = 0;
    setDrafts((d) => {
      const next = { ...d };
      for (const r of rows) {
        const p = byUser.get(r.userId);
        if (p) {
          next[r.userId] = toDraft(p);
          copied++;
        }
      }
      return next;
    });
    if (prev.bonuses) {
      const b = prev.bonuses;
      setBonusDraft({
        targetBonus: String(b.targetBonus),
        fastCloseBonus: String(b.fastCloseBonus),
        referralBonus: String(b.referralBonus),
      });
    }
    setError(null);
    setNotice(
      `Copied ${prevName}'s setup${copied ? ` for ${copied} BDE${copied === 1 ? "" : "s"}` : ""}${
        prev.bonuses ? " and bonuses" : ""
      }. Check it, then Save all.`,
    );
  }

  async function saveAll() {
    if (!dirty || invalid) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/marketing/lead-pulse/incentive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        year,
        month,
        ...(bonusesChanged ? { bonuses: bonusValues } : {}),
        rows: changedRows.map((r) => ({ userId: r.userId, ...fromDraft(drafts[r.userId]) })),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      setError(data.message ?? data.error ?? "Could not save.");
      return;
    }
    setNotice("Saved.");
    router.refresh();
  }

  const sel = rows.find((r) => r.userId === selected) ?? rows[0];
  const selDraft = drafts[sel.userId];
  const selValid = !errors[sel.userId];
  const selSlabs = selValid ? draftSlabs(selDraft) : sel.slabs;
  const selMinimum = selValid ? num(selDraft.minimum) : sel.minimum;
  const ladder = slabLadder(selSlabs);

  const inputStyle = { border: "1px solid var(--lp-outline-variant)" };
  const muted = { color: "var(--lp-on-surface-variant)" };

  return (
    <div className="space-y-[16px]">
      <div
        className="flex flex-wrap items-center justify-between gap-[12px] rounded-[12px] p-[12px] border"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <button
          type="button"
          onClick={copyPrevious}
          disabled={!canCopy}
          className="h-[36px] px-[14px] rounded-[8px] border text-[13px] font-semibold"
          style={{ borderColor: "var(--lp-outline-variant)", opacity: canCopy ? 1 : 0.5 }}
          title={canCopy ? undefined : `Nothing was set for ${prevName}`}
        >
          Copy from {prevName}
        </button>
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

      <section
        aria-labelledby="bonus-h"
        className="flex flex-wrap items-center gap-x-[24px] gap-y-[12px] rounded-[12px] p-[16px] border"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <h2 id="bonus-h" className="text-[13px] font-bold">
          Bonuses this month · all L2 BDEs
        </h2>
        {BONUS_FIELDS.map((f) => (
          <label key={f.key} className="flex items-center gap-[8px] text-[13px]">
            {f.label}
            <span className="flex items-center gap-[4px]">
              <span style={muted}>₹</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={bonusDraft[f.key]}
                disabled={readOnly}
                onChange={(e) => setBonusDraft((b) => ({ ...b, [f.key]: e.target.value }))}
                className="w-[88px] h-[32px] px-[8px] text-right rounded text-[13px] tabular-nums"
                style={inputStyle}
              />
            </span>
            {f.each && <span style={muted}>each</span>}
          </label>
        ))}
        {bonusError && (
          <p className="w-full text-[12px]" style={{ color: "var(--lp-error)" }}>
            {bonusError.label} must be a whole number of rupees.
          </p>
        )}
      </section>

      <div
        className="rounded-[12px] border overflow-x-auto"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <table className="w-full text-[12px] tabular-nums" style={{ minWidth: 1100 }}>
          <thead>
            <tr style={{ backgroundColor: "var(--lp-surface-container-low)" }}>
              {["BDE", "Team", "Target", "So far", "Minimum"].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-[10px] py-[8px] text-left text-[11px] uppercase tracking-[0.05em]"
                  style={muted}
                >
                  {h}
                </th>
              ))}
              {Array.from({ length: SLAB_COUNT }, (_, i) => (
                <th
                  key={i}
                  scope="col"
                  className="px-[10px] py-[8px] text-left text-[11px] uppercase tracking-[0.05em] border-l"
                  style={{ ...muted, borderColor: "var(--lp-outline-variant)" }}
                >
                  Slab {i + 1}
                  {i === 0 && <span className="normal-case tracking-normal"> · from · ₹ each</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = drafts[r.userId];
              const err = errors[r.userId];
              const slabs = err ? r.slabs : draftSlabs(d);
              const pay = computeBdePay({ ...r.facts, target: r.target, slabs, bonuses: liveBonuses });
              const isSel = r.userId === sel.userId;
              return [
                <tr
                  key={r.userId}
                  className="border-t"
                  onFocusCapture={() => setSelected(r.userId)}
                  style={{
                    borderColor: "var(--lp-outline-variant)",
                    backgroundColor: isSel ? "var(--lp-surface-container-high)" : undefined,
                  }}
                >
                  <th scope="row" className="px-[10px] py-[6px] text-left font-semibold">
                    <button
                      type="button"
                      onClick={() => setSelected(r.userId)}
                      aria-pressed={isSel}
                      className="text-left underline-offset-2 hover:underline"
                      title="Show how this BDE's month pays"
                    >
                      {r.name}
                    </button>
                  </th>
                  <td className="px-[10px] py-[6px]" style={muted}>
                    {r.team ?? "—"}
                  </td>
                  <td className="px-[10px] py-[6px]">{r.target || "—"}</td>
                  <td className="px-[10px] py-[6px] whitespace-nowrap">
                    {r.facts.enrolled} · <span style={{ color: "var(--lp-cyan)" }}>{rupees(pay.total)}</span>
                  </td>
                  <td className="px-[10px] py-[6px]">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      aria-label={`${r.name} minimum`}
                      value={d.minimum}
                      placeholder="—"
                      disabled={readOnly}
                      onChange={(e) => setMinimum(r.userId, e.target.value)}
                      className="w-[52px] h-[28px] px-[6px] text-right rounded text-[12px]"
                      style={inputStyle}
                    />
                  </td>
                  {d.slabs.map((s, i) => (
                    <td key={i} className="px-[10px] py-[6px] border-l" style={{ borderColor: "var(--lp-outline-variant)" }}>
                      <div className="flex items-center gap-[4px]">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          aria-label={`${r.name} slab ${i + 1} from`}
                          value={s.from}
                          placeholder="—"
                          disabled={readOnly}
                          onChange={(e) => setSlab(r.userId, i, "from", e.target.value)}
                          className="w-[48px] h-[28px] px-[6px] text-right rounded text-[12px]"
                          style={inputStyle}
                        />
                        <span style={muted}>₹</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          aria-label={`${r.name} slab ${i + 1} rupees each`}
                          value={s.rate}
                          placeholder="—"
                          disabled={readOnly}
                          onChange={(e) => setSlab(r.userId, i, "rate", e.target.value)}
                          className="w-[72px] h-[28px] px-[6px] text-right rounded text-[12px]"
                          style={inputStyle}
                        />
                      </div>
                    </td>
                  ))}
                </tr>,
                err ? (
                  <tr key={`${r.userId}-err`}>
                    <td colSpan={5 + SLAB_COUNT} className="px-[10px] pb-[8px] text-[12px]" style={{ color: "var(--lp-error)" }}>
                      {r.name}: {err}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      <section
        aria-labelledby="preview-h"
        className="rounded-[12px] p-[16px] border space-y-[10px]"
        style={{ backgroundColor: "var(--lp-surface-container)", borderColor: "var(--lp-outline-variant)" }}
      >
        <h2 id="preview-h" className="text-[15px] font-bold">
          How {sel.name}&rsquo;s {monthName} pays
        </h2>
        {ladder.length === 0 ? (
          <p className="text-[13px]" style={muted}>
            No slabs set, so no slab incentive this month.
            {selMinimum !== null && selMinimum > 0 ? ` ${selMinimum} is the expected minimum.` : ""}
          </p>
        ) : (
          <ol className="space-y-[4px] text-[13px]">
            {ladder.map((b) => (
              <li key={b.from} className="flex flex-wrap gap-x-[16px]">
                <span className="w-[140px] font-semibold">
                  {b.to === null ? `${b.from} and above` : `${b.from}–${b.to}`}
                  {b.from === 0 ? " enrolments" : ""}
                </span>
                <span className="w-[140px]">{b.rate === 0 ? "₹0" : `${rupees(b.rate)} × all`}</span>
                <span style={muted}>
                  {b.rate === 0
                    ? selMinimum !== null && selMinimum > 0
                      ? `${selMinimum} is the minimum — expected, not paid`
                      : "nothing paid"
                    : b.payTo === null
                      ? `${rupees(b.payFrom)} at ${b.from}`
                      : `${rupees(b.payFrom)} – ${rupees(b.payTo)}`}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-[12px] leading-[18px]" style={muted}>
          The highest slab reached pays on every enrolment in the month; a half-weight service counts 0.5. Each slab
          must start higher than the one before and pay at least as much. Target comes from the Service targets tab. On
          top: {rupees(liveBonuses.targetBonus)} at target, {rupees(liveBonuses.fastCloseBonus)} per enrolment closed
          within 48 hours of assignment, {rupees(liveBonuses.referralBonus)} per own referral enrolled. The minimum
          pays nothing by itself — it decides who shares a team pool. L1 BDEs aren&rsquo;t on this sheet.
        </p>
      </section>
    </div>
  );
}
