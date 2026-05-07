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
} from "recharts";

// Brand-aligned palette: gold-led, with charcoal + warm browns for variety
// while keeping enough hue separation for category charts.
const COLORS = [
  "#F5C518", // primary gold
  "#1A1A1A", // charcoal
  "#FFB400", // amber
  "#5D4037", // espresso brown
  "#9E9E9E", // neutral gray
  "#FFE082", // pale gold
  "#A1887F", // taupe
  "#7E6510", // dark gold
];

export function MonthlyRevenueExpenseBars({
  data,
}: {
  data: { month: string; revenue: number; expense: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#424751" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: "#424751" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${(v / 1_00_000).toFixed(0)}L`}
        />
        <Tooltip formatter={(v: number) => `₹${(v / 1_00_000).toFixed(2)}L`} cursor={{ fill: "#f2f3fa" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="revenue" name="Revenue" fill="#F5C518" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expense" name="Expense" fill="#1A1A1A" radius={[4, 4, 0, 0]} />
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
          tickFormatter={(v) => `${(v / 1_00_000).toFixed(0)}L`}
        />
        <Tooltip formatter={(v: number) => `₹${(v / 1_00_000).toFixed(2)}L`} />
        <Area type="monotone" dataKey="net" name="Net" stroke="#C9A019" strokeWidth={2.5} fill="url(#netFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CategoryDonut({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col md:flex-row items-center gap-md">
      <div className="w-full md:w-1/2 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={60} outerRadius={90} paddingAngle={2}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: number) => `₹${(v / 1_00_000).toFixed(2)}L`} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full md:w-1/2 space-y-xs">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between text-body-md">
            <span className="flex items-center gap-base min-w-0">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="font-mono text-on-surface">
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
          <div className="w-44 text-label-sm text-on-surface-variant truncate" title={d.name}>{d.name}</div>
          <div className="flex-1 h-9 bg-surface-container rounded flex items-center pr-3">
            <div
              className="h-full rounded"
              style={{ width: `${(d.value / max) * 100}%`, background: COLORS[i % COLORS.length] }}
            />
            <span className="ml-base text-label-sm font-mono text-on-surface">
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
          tickFormatter={(v) => `${(v / 1_00_000).toFixed(0)}L`}
        />
        <Tooltip formatter={(v: number) => `₹${(v / 1_00_000).toFixed(2)}L`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="revenue" name="Inflow" stroke="#C9A019" strokeWidth={2.5} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="expense" name="Outflow" stroke="#BA1A1A" strokeWidth={2.5} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
