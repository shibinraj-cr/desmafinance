"use client";

import Link from "next/link";
import { Section } from "@/components/Cards";

type Mark = { kind: "taken" | "planned"; half: boolean; status: string };
type Day = { iso: string; day: number; weekday: string; sunday: boolean; holiday: string | null };
type Row = { id: string; empCode: string; name: string; marks: Record<string, Mark> };

/**
 * A count per day sits above the grid. That row is the point of the page: an
 * approver scanning for clashes is asking "how many people are already off
 * that day", and reading it off the body of a grid is exactly the work this
 * saves them.
 */
function tone(m: Mark): string {
  if (m.kind === "taken") {
    return m.half ? "bg-amber-200 text-amber-900" : "bg-purple-200 text-purple-900";
  }
  // Still a request — outlined rather than filled, so settled leave and
  // expected leave are never mistaken for each other at a glance.
  return m.status === "approved"
    ? "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-300"
    : "bg-surface-container text-on-surface-variant ring-1 ring-inset ring-outline-variant";
}

function label(m: Mark): string {
  if (m.half) return "½";
  return m.kind === "taken" ? "L" : "·";
}

export function LeaveCalendarClient({
  month,
  prevMonth,
  nextMonth,
  days,
  rows,
}: {
  month: string;
  prevMonth: string;
  nextMonth: string;
  days: Day[];
  rows: Row[];
}) {
  const perDay = days.map((d) => rows.filter((r) => r.marks[d.iso]).length);
  const busiest = Math.max(1, ...perDay);

  return (
    <Section
      title=""
      action={
        <div className="flex items-center gap-xs">
          <Link
            href={`/hr/leave-calendar?month=${prevMonth}`}
            className="px-sm py-xs rounded-lg bg-surface-container text-label-sm"
          >
            ← Prev
          </Link>
          <span className="text-label-sm font-semibold px-xs">{month}</span>
          <Link
            href={`/hr/leave-calendar?month=${nextMonth}`}
            className="px-sm py-xs rounded-lg bg-surface-container text-label-sm"
          >
            Next →
          </Link>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="py-lg text-center text-on-surface-variant">
          Nobody is on leave this month, and nothing is planned.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-label-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 bg-surface z-10 px-sm py-xs text-left">Employee</th>
                {days.map((d) => (
                  <th
                    key={d.iso}
                    title={d.holiday ?? undefined}
                    className={
                      "px-[2px] py-xs text-caption font-semibold w-7 " +
                      (d.sunday || d.holiday ? "text-on-surface-variant/50" : "")
                    }
                  >
                    {d.day}
                    <br />
                    <span className="font-normal">{d.weekday[0]}</span>
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 bg-surface z-10 px-sm py-xs text-left text-caption font-normal text-on-surface-variant">
                  On leave
                </th>
                {days.map((d, i) => (
                  <th
                    key={d.iso}
                    className={
                      "px-[2px] py-xs text-caption font-bold " +
                      (perDay[i] === 0
                        ? "text-on-surface-variant/40"
                        : perDay[i] >= busiest
                          ? "text-red-700"
                          : "text-on-surface")
                    }
                  >
                    {perDay[i] || "·"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-outline-variant">
                  <td className="sticky left-0 bg-surface z-10 px-sm py-xs whitespace-nowrap font-medium">
                    {r.empCode} · {r.name}
                  </td>
                  {days.map((d) => {
                    const m = r.marks[d.iso];
                    return (
                      <td key={d.iso} className="px-[1px] py-[1px]">
                        {m ? (
                          <div
                            title={`${d.iso} · ${m.kind === "taken" ? "leave taken" : `request ${m.status}`}${m.half ? " (half day)" : ""}`}
                            className={
                              "rounded text-center text-[10px] font-bold leading-5 h-5 " + tone(m)
                            }
                          >
                            {label(m)}
                          </div>
                        ) : (
                          <div
                            className={
                              "h-5 rounded " +
                              (d.sunday || d.holiday ? "bg-surface-container/60" : "")
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-on-surface-variant mt-md">
        <span className="font-bold text-purple-700">L</span> leave taken (written to attendance) ·{" "}
        <span className="font-bold text-amber-700">½</span> half day ·{" "}
        <span className="font-bold">outlined</span> still a request — approved but not yet reached,
        or awaiting a decision. Sundays and holidays are shaded and never counted as leave. The
        &ldquo;On leave&rdquo; row counts people per day, so a date several people have already
        asked for stands out before you approve another.
      </p>
    </Section>
  );
}
