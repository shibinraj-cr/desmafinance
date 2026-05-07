"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Area,
  AreaChart,
  LabelList,
} from "recharts";
import { inr } from "@/lib/format";

// Brand-aligned categorical palette: gold-led with warm browns and a lighter
// gray, deliberately avoiding pure charcoal so dark bars don't disappear into
// the page background at small sizes.
const COLORS = [
  "#F5C518", // primary gold
  "#7E6510", // dark gold (for AA-readable bars)
  "#FFB400", // amber
  "#5D4037", // espresso brown
  "#A1887F", // taupe
  "#FFD54F", // mid gold
  "#C9A019", // dark amber
  "#9E9E9E", // neutral gray
];

function lakhFormatter(v: number) {
  return `${(v / 1_00_000).toFixed(0)}L`;
}

export function MonthlyRevenueExpenseBars({
  data,
}: {
  data: { month: string; revenue: number; expense: number }[];
}) {
  // Show data labels in lakh format only on bars with meaningful values
  // (≥ ₹1L) to avoid cluttering tiny bars.
  const labelFormatter = (v: number) =>
    Math.abs(v) >= 1_00_000 ? `${(v / 1_00_000).toFixed(1)}L` : "";

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 25, right: 10, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#424751" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: "#424751" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={lakhFormatter}
        />
        <Tooltip formatter={(v: number) => inr(v)} cursor={{ fill: "#f2f3fa" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="revenue" name="Revenue" fill="#F5C518" radius={[4, 4, 0, 0]}>
          <LabelList
            dataKey="revenue"
            position="top"
            formatter={labelFormatter}
            fill="#7E6510"
            style={{ fontSize: 10, fontWeight: 600 }}
          />
        </Bar>
        <Bar dataKey="expense" name="Expense" fill="#5D4037" radius={[4, 4, 0, 0]}>
          <LabelList
            dataKey="expense"
            position="top"
            formatter={labelFormatter}
            fill="#5D4037"
            style={{ fontSize: 10, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function NetCashFlowLine({ data }: { data: { month: string; net: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
        <defs>
          <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#F5C518" stopOpacity={0.45} />
            <stop offset="95%" stopColor="#F5C518" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#424751" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: "#424751" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={lakhFormatter}
        />
        <Tooltip formatter={(v: number) => inr(v)} />
        <Area type="monotone" dataKey="net" name="Net" stroke="#C9A019" strokeWidth={2.5} fill="url(#netFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CategoryDonut({
  data,
  centerTotal,
  centerLabel = "Total",
}: {
  data: { name: string; value: number }[];
  /** When supplied, shown in the center of the donut. */
  centerTotal?: number | null;
  centerLabel?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col md:flex-row items-center gap-md">
      <div className="relative w-full md:w-1/2 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={62} outerRadius={92} paddingAngle={2}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => inr(v)} />
          </PieChart>
        </ResponsiveContainer>
        {centerTotal !== undefined && centerTotal !== null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-caption text-on-surface-variant uppercase tracking-wider">
              {centerLabel}
            </span>
            <span className="text-h3 font-semibold text-on-surface">{inr(centerTotal)}</span>
          </div>
        )}
      </div>
      <ul className="w-full md:w-1/2 space-y-xs">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between text-body-md">
            <span className="flex items-center gap-base min-w-0">
              <span
                className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="font-mono text-on-surface ml-base">
              {total ? Math.round((d.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HorizontalBars({ data }: { data: { name: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-md">
      {data.map((d, i) => (
        <div key={d.name} className="flex items-center gap-md">
          <div className="w-44 text-label-sm text-on-surface-variant truncate" title={d.name}>
            {d.name}
          </div>
          <div className="flex-1 h-9 bg-surface-container rounded flex items-center pr-3">
            <div
              className="h-full rounded transition-all"
              style={{ width: `${(d.value / max) * 100}%`, background: COLORS[i % COLORS.length] }}
            />
            <span className="ml-base text-label-sm font-mono text-on-surface whitespace-nowrap">
              ₹{(d.value / 1_00_000).toFixed(2)}L
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CashflowDualLine({
  data,
}: {
  data: { month: string; revenue: number; expense: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#424751" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: "#424751" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={lakhFormatter}
        />
        <Tooltip formatter={(v: number) => inr(v)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="revenue" name="Inflow" stroke="#C9A019" strokeWidth={2.5} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="expense" name="Outflow" stroke="#BA1A1A" strokeWidth={2.5} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
