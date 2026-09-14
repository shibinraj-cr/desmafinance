"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Section } from "@/components/Cards";
import { FyComparisonBars } from "@/components/Charts";
import { inr, inrFull } from "@/lib/format";
import { FY_MONTH_SHORT, fyLabel } from "@/lib/fiscal-year";
import { changeOn, type ExpenseMatrix, type MatrixRow } from "@/lib/expense-matrix";

/**
 * Single-hue gold ramp for the heat cells: magnitude is one quantity, so it
 * gets one hue, light to dark. It stops short of the brand gold's full
 * saturation on purpose — every step has to stay readable under the cell's own
 * figure, which is the number people actually come here for.
 */
const HEAT = ["#FDF9EC", "#FAF0D2", "#F6E5B0", "#F1D888", "#EBC95E", "#E4BB3A"];

type CellMode = "amount" | "share" | "delta";
type HeatScope = "row" | "grid" | "off";

export function FyPicker({ fy, years }: { fy: number; years: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  return (
    <select
      value={String(fy)}
      onChange={(e) => {
        const params = new URLSearchParams(search.toString());
        params.set("fy", e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className="h-9 px-md rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface text-label-sm font-semibold focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none transition"
      aria-label="Fiscal year"
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {fyLabel(y)}
        </option>
      ))}
    </select>
  );
}

export function ExpenseMatrixView({
  matrix,
  fyName,
  priorFyName,
  monthLabels,
  priorMonthLabels,
}: {
  matrix: ExpenseMatrix;
  fyName: string;
  priorFyName: string;
  monthLabels: string[];
  priorMonthLabels: string[];
}) {
  const [mode, setMode] = useState<CellMode>("amount");
  const [heat, setHeat] = useState<HeatScope>("row");
  const [focus, setFocus] = useState<string | null>(null);

  const { rows, monthTotals, priorMonthTotals, postedMonths, hasPrior } = matrix;

  const gridMax = useMemo(
    () => Math.max(0, ...rows.flatMap((r) => r.months.map((v) => v ?? 0))),
    [rows],
  );

  const focused = focus ? (rows.find((r) => r.name === focus) ?? null) : null;

  const chartData = useMemo(() => {
    const current = focused ? focused.months : monthTotals;
    const prior = focused ? focused.priorMonths : priorMonthTotals;
    return FY_MONTH_SHORT.map((m, i) => ({
      month: m,
      current: current[i] ?? null,
      prior: prior ? prior[i] : null,
    }));
  }, [focused, monthTotals, priorMonthTotals]);

  if (rows.length === 0) {
    return (
      <Section title="Category × month">
        <p className="py-lg text-center text-on-surface-variant">
          No expenses posted in {fyName}.
        </p>
      </Section>
    );
  }

  return (
    <div className="space-y-lg">
      {!hasPrior && (
        <p className="flex items-start gap-sm px-md py-sm rounded-lg border border-outline-variant border-l-4 border-l-primary bg-surface-container-low text-body-md text-on-surface-variant">
          <span aria-hidden>ⓘ</span>
          <span>
            {priorFyName} holds no expenses, so there is nothing to compare against yet. The
            year-on-year columns fill in on their own once an earlier year is in the ledger.
          </span>
        </p>
      )}

      <Section
        title="Category × month"
        action={
          <div className="flex flex-wrap items-center gap-base">
            <Toggle<CellMode>
              label="Cell shows"
              value={mode}
              onChange={setMode}
              options={[
                { value: "amount", label: "Amount" },
                { value: "share", label: "% of month" },
                {
                  value: "delta",
                  label: "Δ vs LY",
                  disabled: !hasPrior,
                  title: hasPrior ? undefined : `No ${priorFyName} in the ledger`,
                },
              ]}
            />
            <Toggle<HeatScope>
              label="Shading"
              value={heat}
              onChange={setHeat}
              options={[
                { value: "row", label: "By row" },
                { value: "grid", label: "By grid" },
                { value: "off", label: "Off" },
              ]}
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-body-md border-collapse">
            <caption className="sr-only">
              {fyName} expenses by category and month, with the same months of {priorFyName}.
            </caption>
            <thead>
              <tr className="text-on-surface-variant">
                <th scope="col" className="text-left py-sm pr-md text-label-sm uppercase sticky left-0 bg-surface-container-lowest z-10 min-w-[180px]">
                  Category
                </th>
                {FY_MONTH_SHORT.map((m, i) => (
                  <th
                    key={m}
                    scope="col"
                    className={
                      "py-sm px-sm text-label-sm uppercase text-right whitespace-nowrap " +
                      (i >= postedMonths ? "opacity-40" : "")
                    }
                    title={monthLabels[i]}
                  >
                    {m}
                  </th>
                ))}
                <th scope="col" className="py-sm px-sm text-label-sm uppercase text-right border-l border-outline-variant whitespace-nowrap">
                  {postedMonths === 12 ? "FY total" : "FY to date"}
                </th>
                <th scope="col" className="py-sm pl-sm text-label-sm uppercase text-right whitespace-nowrap">
                  Δ vs LY
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <MatrixTableRow
                  key={r.name}
                  row={r}
                  mode={mode}
                  heat={heat}
                  gridMax={gridMax}
                  monthTotals={monthTotals}
                  postedMonths={postedMonths}
                  selected={focus === r.name}
                  onSelect={() => setFocus(focus === r.name ? null : r.name)}
                  monthLabels={monthLabels}
                  priorMonthLabels={priorMonthLabels}
                />
              ))}
              <tr className="border-t-2 border-outline-variant font-bold bg-surface-container-low">
                <th scope="row" className="text-left py-sm pr-md sticky left-0 bg-surface-container-low z-10">
                  Total
                </th>
                {FY_MONTH_SHORT.map((m, i) => (
                  <td key={m} className="py-sm px-sm text-right font-mono whitespace-nowrap">
                    {monthTotals[i] === null ? (
                      <span className="text-on-surface-variant opacity-40">·</span>
                    ) : mode === "share" ? (
                      "100%"
                    ) : mode === "delta" ? (
                      <DeltaText
                        pct={changeOn(monthTotals[i]!, priorMonthTotals ? priorMonthTotals[i] : null)}
                        compact
                      />
                    ) : (
                      lakh(monthTotals[i]!)
                    )}
                  </td>
                ))}
                <td className="py-sm px-sm text-right font-mono border-l border-outline-variant whitespace-nowrap">
                  {lakh(matrix.total)}
                </td>
                <td className="py-sm pl-sm text-right whitespace-nowrap">
                  <DeltaText pct={matrix.changePct} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-md flex flex-wrap items-center gap-base text-caption text-on-surface-variant">
          {heat !== "off" && (
            <span className="flex items-center gap-xs">
              Lighter
              <span className="flex" aria-hidden>
                {HEAT.map((c) => (
                  <i key={c} className="block w-5 h-[10px]" style={{ background: c }} />
                ))}
              </span>
              Heavier
            </span>
          )}
          <span>
            {heat === "row"
              ? "Shaded against each category's own biggest month"
              : heat === "grid"
                ? "Shaded against the biggest cell in the grid"
                : "Shading off"}
          </span>
          {postedMonths < 12 && (
            <span>· Months marked · have not begun, so they are blank rather than zero</span>
          )}
          <span className="ml-auto">Figures in ₹ lakh</span>
        </div>
      </Section>

      <Section
        title={focused ? `${focused.name} — month by month` : "Monthly spend, this FY vs last"}
        action={
          focused ? (
            <button
              type="button"
              onClick={() => setFocus(null)}
              className="h-9 px-md rounded-lg border border-outline-variant text-label-sm font-semibold hover:border-primary transition"
            >
              Show all categories
            </button>
          ) : (
            <span className="text-caption text-on-surface-variant">
              Pick a category above to chart it on its own
            </span>
          )
        }
      >
        <FyComparisonBars
          data={chartData}
          currentName={fyName}
          priorName={priorFyName}
          showPrior={hasPrior}
        />
      </Section>

      <Section title="Every category, month by month">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-gutter">
          {rows.map((r) => (
            <SparkPanel
              key={r.name}
              row={r}
              grandTotal={matrix.total}
              postedMonths={postedMonths}
              hasPrior={hasPrior}
              selected={focus === r.name}
              onSelect={() => setFocus(focus === r.name ? null : r.name)}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

function MatrixTableRow({
  row,
  mode,
  heat,
  gridMax,
  monthTotals,
  postedMonths,
  selected,
  onSelect,
  monthLabels,
  priorMonthLabels,
}: {
  row: MatrixRow;
  mode: CellMode;
  heat: HeatScope;
  gridMax: number;
  monthTotals: (number | null)[];
  postedMonths: number;
  selected: boolean;
  onSelect: () => void;
  monthLabels: string[];
  priorMonthLabels: string[];
}) {
  const rowMax = Math.max(0, ...row.months.map((v) => v ?? 0));
  const scale = heat === "grid" ? gridMax : rowMax;

  return (
    <tr
      onClick={onSelect}
      className={
        "border-t border-outline-variant/60 cursor-pointer " +
        (selected ? "bg-primary-fixed/25" : "hover:bg-surface-container-low")
      }
    >
      <th
        scope="row"
        className={
          "text-left py-sm pr-md font-medium sticky left-0 z-10 whitespace-nowrap " +
          (selected ? "bg-primary-fixed/40 shadow-[inset_3px_0_0_#C9A019]" : "bg-surface-container-lowest")
        }
      >
        {/* The button, not the row, is the control: a <tr> has no interactive
            role to hang aria-pressed on, and keyboard users need a real tab
            stop. Clicking anywhere in the row is a mouse-only convenience. */}
        <button
          type="button"
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 hover:text-accent transition"
        >
          {row.name}
        </button>
        {row.isOther && (
          <span className="ml-xs text-caption text-on-surface-variant font-normal">
            (folded)
          </span>
        )}
      </th>

      {row.months.map((v, i) => {
        if (v === null) {
          return (
            <td key={i} className="py-sm px-sm text-right text-on-surface-variant opacity-40">
              ·
            </td>
          );
        }
        const prior = row.priorMonths ? row.priorMonths[i] : null;
        const monthTotal = monthTotals[i];
        const delta = changeOn(v, prior);
        const shaded = heat !== "off" && scale > 0 ? heatColour(v, scale) : undefined;

        return (
          <td
            key={i}
            className="py-sm px-sm text-right font-mono whitespace-nowrap"
            style={shaded ? { background: shaded } : undefined}
            title={
              `${row.name} · ${monthLabels[i]}: ${inrFull(v)}` +
              (prior !== null ? ` · ${priorMonthLabels[i]}: ${inrFull(prior)}` : "") +
              (monthTotal ? ` · ${((v / monthTotal) * 100).toFixed(1)}% of the month` : "")
            }
          >
            {mode === "amount" ? (
              lakh(v)
            ) : mode === "share" ? (
              monthTotal ? (
                `${Math.round((v / monthTotal) * 100)}%`
              ) : (
                "—"
              )
            ) : (
              <DeltaText pct={delta} compact />
            )}
          </td>
        );
      })}

      <td className="py-sm px-sm text-right font-mono font-semibold border-l border-outline-variant bg-surface-container-low/60 whitespace-nowrap">
        {lakh(row.total)}
      </td>
      <td className="py-sm pl-sm text-right bg-surface-container-low/60 whitespace-nowrap">
        <DeltaText pct={row.changePct} />
      </td>
    </tr>
  );
}

function SparkPanel({
  row,
  grandTotal,
  postedMonths,
  hasPrior,
  selected,
  onSelect,
}: {
  row: MatrixRow;
  grandTotal: number;
  postedMonths: number;
  hasPrior: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const max = Math.max(
    1,
    ...row.months.map((v) => v ?? 0),
    ...(row.priorMonths ?? []),
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        "text-left p-md rounded-xl border transition " +
        (selected
          ? "border-primary bg-primary-fixed/20"
          : "border-outline-variant hover:border-primary/60")
      }
    >
      <div className="flex items-baseline justify-between gap-sm">
        <span className="font-semibold">{row.name}</span>
        <span className="font-mono font-semibold whitespace-nowrap">{inr(row.total)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-sm text-caption text-on-surface-variant">
        <span>{grandTotal ? `${((row.total / grandTotal) * 100).toFixed(1)}% of spend` : "—"}</span>
        <DeltaText pct={row.changePct} />
      </div>
      <div className="mt-md flex items-end gap-[3px] h-12" role="img" aria-label={`${row.name} by month`}>
        {row.months.map((v, i) => (
          <span key={i} className="flex-1 flex items-end justify-center gap-[1px] h-full">
            {hasPrior && row.priorMonths && (
              <i
                className="block w-1/2 max-w-[6px] rounded-t-sm"
                style={{ height: `${(row.priorMonths[i] / max) * 100}%`, background: "#A45A2A" }}
              />
            )}
            <i
              className="block w-1/2 max-w-[6px] rounded-t-sm"
              style={{
                height: v === null ? "2px" : `${Math.max(2, (v / max) * 100)}%`,
                background: i >= postedMonths ? "#D5D5D5" : "#C9A019",
              }}
            />
          </span>
        ))}
      </div>
    </button>
  );
}

/* ── bits ─────────────────────────────────────────────────────────────────── */

function Toggle<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
}) {
  return (
    <div className="flex items-center gap-xs">
      <span className="text-label-sm uppercase tracking-wider text-on-surface-variant hidden lg:inline">
        {label}
      </span>
      <div className="inline-flex p-[2px] rounded-lg border border-outline-variant bg-surface-container-low" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            title={o.title}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={
              "px-md py-[5px] rounded-md text-label-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed " +
              (value === o.value
                ? "bg-surface-container-lowest text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Spend is up-is-bad, so a rise is red and a fall is green — the inverse of
 *  every revenue chip in Finance. */
function DeltaText({ pct, compact }: { pct: number | null; compact?: boolean }) {
  if (pct === null) return <span className="text-on-surface-variant">—</span>;
  const up = pct > 0;
  const tone = pct === 0 ? "text-on-surface-variant" : up ? "text-error" : "text-green-700";
  return (
    <span className={"font-mono font-semibold whitespace-nowrap " + tone}>
      {pct === 0 ? "" : up ? "▲" : "▼"}
      {compact ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function heatColour(value: number, scale: number): string | undefined {
  const ratio = value / scale;
  if (ratio <= 0.02) return undefined;
  return HEAT[Math.min(HEAT.length - 1, Math.floor(ratio * HEAT.length))];
}

/** Grid figures are in lakh throughout — a column of full rupee amounts is
 *  unscannable, and the header says the unit once. */
function lakh(n: number): string {
  return (n / 1_00_000).toFixed(2);
}
