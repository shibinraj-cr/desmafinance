"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { inr } from "@/lib/format";

function lakhFormatter(v: number) {
  return `${(v / 1_00_000).toFixed(0)}L`;
}

/**
 * Combined Revenue / Expense / Net chart — one bar pair per month plus the
 * net-position line. The CEO's primary trend lens.
 */
export function RevenueExpenseNetChart({
  data,
}: {
  data: { month: string; revenue: number; expense: number; net: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 20, right: 16, left: 0, bottom: 10 }}>
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
        <ReferenceLine y={0} stroke="#9E9E9E" strokeDasharray="2 2" />
        <Bar dataKey="revenue" name="Revenue" fill="#F5C518" radius={[3, 3, 0, 0]} />
        <Bar dataKey="expense" name="Expense" fill="#5D4037" radius={[3, 3, 0, 0]} />
        <Line type="monotone" dataKey="net" name="Net" stroke="#C9A019" strokeWidth={2.5} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Month-on-month enrollments (closed_won counts) from Lead Pulse. */
export function EnrollmentsChart({
  data,
}: {
  data: { month: string; enrollments: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#424751" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: "#424751" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip />
        <Bar dataKey="enrollments" name="Enrollments" fill="#7E6510" radius={[3, 3, 0, 0]} />
        <Line type="monotone" dataKey="enrollments" stroke="#C9A019" strokeWidth={2} dot={{ r: 3 }} legendType="none" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
