"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type DayPoint = { date: string; label: string; answered: number; missed: number; offDay: boolean; holiday: string | null };

/** After-hours queries per report day: answered (gold) + no reply by 9 AM (brown). Sundays/holidays get a darker label. */
export function DailyQueriesChart({ data }: { data: DayPoint[] }) {
  const offDays = new Set(data.filter((d) => d.offDay).map((d) => d.label));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e2e9" vertical={false} />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          interval={0}
          tick={(props: { x: number; y: number; payload: { value: string } }) => {
            const off = offDays.has(props.payload.value);
            return (
              <text
                x={props.x}
                y={props.y + 12}
                textAnchor="middle"
                fontSize={11}
                fontWeight={off ? 700 : 400}
                fill={off ? "#7E6510" : "#424751"}
              >
                {props.payload.value}
              </text>
            );
          }}
        />
        <YAxis tick={{ fontSize: 12, fill: "#424751" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "#f2f3fa" }}
          labelFormatter={(_l, p) => {
            const d = p?.[0]?.payload as DayPoint | undefined;
            if (!d) return "";
            return d.date + (d.holiday ? ` · ${d.holiday}` : d.offDay ? " · Sunday" : "");
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="answered" name="Answered" stackId="q" fill="#F5C518">
          {data.map((d) => (
            <Cell key={d.date} fill={d.offDay ? "#C9A019" : "#F5C518"} />
          ))}
        </Bar>
        <Bar dataKey="missed" name="No reply by 9 AM" stackId="q" fill="#5D4037" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal share bars (plain counts). */
export function ShareBars({ data }: { data: { name: string; value: number; pct: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-sm">
      {data.map((d) => (
        <div key={d.name} className="flex items-center gap-md">
          <div className="w-32 text-label-sm text-on-surface-variant truncate" title={d.name}>
            {d.name}
          </div>
          <div className="flex-1 h-7 bg-surface-container rounded flex items-center pr-3">
            <div className="h-full rounded bg-primary" style={{ width: `${Math.max((d.value / max) * 100, 1)}%` }} />
            <span className="ml-base text-label-sm font-mono text-on-surface whitespace-nowrap">
              {d.value} · {d.pct}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Compact 0–10 score meter. */
export function ScoreMeter({ value }: { value: number | null }) {
  if (value == null) return <span className="text-on-surface-variant">voice only</span>;
  const good = value >= 7.2;
  return (
    <div className="flex items-center gap-base">
      <div className="w-24 h-2 bg-surface-container rounded overflow-hidden">
        <div className={"h-full rounded " + (good ? "bg-green-600" : "bg-primary-container")} style={{ width: `${value * 10}%` }} />
      </div>
      <span className="font-mono text-label-sm">{value.toFixed(1)}</span>
    </div>
  );
}
